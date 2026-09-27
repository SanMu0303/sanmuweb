import test from "node:test";
import assert from "node:assert/strict";
import {
  announcement,
  DEFAULT_VOICE_VOLUME,
  newVoiceSignals,
  normalizeVoiceVolume,
  spellAssetSymbol,
  speechOptions,
} from "../terminal-source-src/alerts/voice.mjs";
test("voice excludes historical, future and ignored signals and deduplicates merged IDs", () => {
  const now = 2000000000000,
    enabled = now - 60000,
    seen = new Set();
  const s = {
    id: "a",
    symbol: "BTCUSDT",
    type: "volume",
    timeframe: "1H",
    triggeredAt: now / 1000 - 3600,
    status: "unread",
  };
  assert.equal(
    newVoiceSignals(
      [
        { ...s, id: "old", triggeredAt: s.triggeredAt - 3600 },
        { ...s, id: "future", triggeredAt: s.triggeredAt + 3600 },
        { ...s, id: "ignored", status: "ignored" },
        s,
      ],
      seen,
      enabled,
      now,
    ).length,
    1,
  );
  assert.equal(newVoiceSignals([s], seen, enabled, now).length, 0);
  assert.equal(announcement(s, "LIVE"), "B T C，成交量异常");
  assert.match(announcement(s, "DEMO"), /模拟信号/);
});
test("voice volume is clamped to the browser's 0-to-1 range", () => {
  assert.equal(normalizeVoiceVolume(0), 0);
  assert.equal(normalizeVoiceVolume("0.35"), 0.35);
  assert.equal(normalizeVoiceVolume(-1), 0);
  assert.equal(normalizeVoiceVolume(2), 1);
  assert.equal(normalizeVoiceVolume(""), DEFAULT_VOICE_VOLUME);
  assert.equal(normalizeVoiceVolume("not-a-number"), DEFAULT_VOICE_VOLUME);
  assert.deepEqual(speechOptions(1.5), {
    lang: "zh-CN",
    rate: 1,
    volume: 1,
  });
});
test("ticker symbols are spelled one character at a time for Chinese speech", () => {
  assert.equal(spellAssetSymbol("BTCUSDT"), "B T C");
  assert.equal(spellAssetSymbol("ethUSDC"), "E T H");
  assert.equal(spellAssetSymbol("1000PEPEUSDT"), "1 0 0 0 P E P E");
  assert.equal(announcement({ symbol: "SOLUSDT", type: "oi" }, "LIVE"), "S O L，持仓量异常");
});
test("voice limits burst queue and never replays while disabled", () => {
  const now = 2000000000000,
    seen = new Set();
  const list = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    symbol: "BTCUSDT",
    type: "oi",
    timeframe: "1H",
    triggeredAt: now / 1000 - 3600,
  }));
  assert.equal(newVoiceSignals(list, seen, now - 1000, now).length, 5);
  assert.equal(newVoiceSignals(list, seen, now - 1000, now).length, 0);
  assert.equal(newVoiceSignals(list, new Set(), 0, now).length, 0);
});
