import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBinanceOiHistory,
  oiPeriodEndToKlineOpen,
} from "../terminal-source-src/providers/binance.mjs";

const START = 1_728_000_000; // exact 15-minute boundary in Unix seconds

test("maps Binance OI period-end timestamps onto the matching K-line open", () => {
  assert.equal(oiPeriodEndToKlineOpen((START + 900) * 1_000, "15m"), START);
  assert.equal(oiPeriodEndToKlineOpen((START + 900) * 1_000 - 1, "15m"), START);
  assert.equal(oiPeriodEndToKlineOpen((START + 3_600) * 1_000, "1H"), START);
});

test("normalizes OI history by K-line time, de-duplicates pages, and respects the K-line range", () => {
  const points = normalizeBinanceOiHistory([
    // Two overlapping paginated records for the first 15m candle. The newer
    // raw snapshot wins, while the stable result still has one chart point.
    {timestamp: (START + 900) * 1_000 - 500, sumOpenInterest: "100"},
    {timestamp: (START + 900) * 1_000 - 1, sumOpenInterest: "101"},
    {timestamp: (START + 1_800) * 1_000, sumOpenInterest: "120"},
    {timestamp: (START + 2_700) * 1_000, sumOpenInterest: "130"},
    // This lies just before the selected K-line window and must not leak in.
    {timestamp: START * 1_000, sumOpenInterest: "90"},
  ], "15m", {start: START, end: START + 1_800});

  assert.deepEqual(points, [
    {time: START, value: 101},
    {time: START + 900, value: 120},
    {time: START + 1_800, value: 130},
  ]);
});
