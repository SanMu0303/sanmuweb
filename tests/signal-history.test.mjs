import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSignalHistoryClearedAt,
  signalDetectedAt,
  signalsAfterHistoryClear,
} from "../terminal-source-src/signalHistory.mjs";

test("cleared signal history retains only events generated after the clear boundary", () => {
  const clearedAt = 1_700_000_000_000;
  const signals = [
    { id: "old-detected", detectedAt: clearedAt - 1 },
    { id: "old-triggered", triggeredAt: Math.floor((clearedAt - 1) / 1_000) },
    { id: "new", detectedAt: clearedAt + 1 },
    { id: "unknown-time" },
  ];

  assert.deepEqual(
    signalsAfterHistoryClear(signals, clearedAt).map((signal) => signal.id),
    ["new"],
  );
});

test("signal history cutoff accepts seconds or milliseconds without losing precision", () => {
  assert.equal(normalizeSignalHistoryClearedAt(1_700_000_000), 1_700_000_000_000);
  assert.equal(signalDetectedAt({ triggeredAt: 1_700_000_001 }), 1_700_000_001_000);
  assert.equal(normalizeSignalHistoryClearedAt("invalid"), 0);
});
