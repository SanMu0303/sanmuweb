import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_HEAT_SOURCE,
  createBrowserContractHeatLoader,
} from "../terminal-source-src/contractHeat.mjs";

function fixtureSymbols(count) {
  return Array.from({ length: count }, (_, index) => `T${String(index + 1).padStart(2, "0")}USDT`);
}

test("browser heat fallback only reads bounded Binance USDⓈ-M public data and caches its Top 20", async () => {
  let now = 1_728_000_000_000;
  const symbols = fixtureSymbols(64);
  const requests = [];
  let activeOiRequests = 0;
  let maxActiveOiRequests = 0;
  const loader = createBrowserContractHeatLoader({
    now: () => now,
    async fetcher(input) {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.origin, "https://fapi.binance.com");
      if (url.pathname === "/fapi/v1/exchangeInfo") {
        return Response.json({
          symbols: [
            ...symbols.map((symbol) => ({
              symbol,
              status: "TRADING",
              quoteAsset: "USDT",
              marginAsset: "USDT",
              contractType: "PERPETUAL",
            })),
            // These must never enter the ranking universe.
            { symbol: "EXPIREDUSDT", status: "EXPIRED", quoteAsset: "USDT", marginAsset: "USDT", contractType: "PERPETUAL" },
            { symbol: "BTCUSDC", status: "TRADING", quoteAsset: "USDC", marginAsset: "USDC", contractType: "PERPETUAL" },
          ],
        });
      }
      if (url.pathname === "/fapi/v1/ticker/24hr") {
        return Response.json(symbols.map((symbol, index) => ({
          symbol,
          quoteVolume: String((200 - index) * 1_000_000),
          count: String(20_000 - index),
          priceChangePercent: String(index % 2 ? -(index + 1) : index + 1),
          highPrice: "1.10",
          lowPrice: "0.90",
        })));
      }
      if (url.pathname === "/futures/data/openInterestHist") {
        assert.equal(url.searchParams.get("period"), "1h");
        assert.equal(url.searchParams.get("limit"), "6");
        activeOiRequests += 1;
        maxActiveOiRequests = Math.max(maxActiveOiRequests, activeOiRequests);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeOiRequests -= 1;
        const symbol = url.searchParams.get("symbol");
        if (symbol === "T10USDT") return new Response("temporary OI failure", { status: 503 });
        return Response.json(Array.from({ length: 6 }, (_, index) => ({
          timestamp: String(now - (5 - index) * 3_600_000),
          sumOpenInterestValue: String(1_000_000 + index * 1_000),
        })));
      }
      throw new Error(`unexpected public endpoint: ${url.pathname}`);
    },
  });

  const first = await loader();
  const firstRequestCount = requests.length;
  const oiRequests = requests.filter((url) => url.pathname === "/futures/data/openInterestHist");

  assert.equal(first.source, BROWSER_HEAT_SOURCE);
  assert.equal(first.fallback, true);
  assert.equal(first.universeSize, 64);
  assert.equal(first.candidateCount, 60, "fallback only scores the top 60 liquid contracts");
  assert.equal(first.items.length, 20);
  assert.equal(first.items.every((item, index) => item.rank === index + 1), true);
  assert.equal(oiRequests.length, 60, "one bounded six-point OI request per candidate");
  assert.ok(maxActiveOiRequests <= 4, "browser fallback caps concurrent OI requests");
  assert.equal(
    first.items.find((item) => item.symbol === "T10USDT")?.components?.effectiveWeights?.oi,
    0,
    "one failed OI request must only reweight that contract",
  );

  await loader();
  assert.equal(requests.length, firstRequestCount, "the 90-second cache prevents repeat browser fan-out");

  now += 90_001;
  await loader();
  assert.ok(requests.length > firstRequestCount, "data is refreshed after cache expiry");
});
