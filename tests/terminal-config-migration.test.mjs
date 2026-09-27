import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_SCHEMA_VERSION,
  DEFAULTS,
  decodeScannerConfig,
  encodeScannerConfig,
} from "../terminal-source-src/scanner/config.mjs";

test("migrates the legacy 3x volume default while retaining supported old settings", () => {
  const config = decodeScannerConfig({
    volume: 3,
    oi1h: 12,
    oi4h: 30,
    lookback: 60,
    minOpenInterestM: 50,
  });

  assert.equal(config.volume, 10);
  assert.equal(config.oi1h, 12);
  assert.equal(config.oi4h, 30);
  assert.equal("lookback" in config, false);
  assert.equal("minOpenInterestM" in config, false);
});

test("keeps a non-default legacy volume choice instead of treating every old value as a default", () => {
  const config = decodeScannerConfig({ volume: 6.5, oi1h: 18 });
  assert.equal(config.volume, 6.5);
  assert.equal(config.oi1h, 18);
});

test("a versioned save preserves a new explicit 3x choice after migration", () => {
  const stored = encodeScannerConfig({ ...DEFAULTS, volume: 3, oi4h: 28 });
  assert.equal(stored.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(stored.values.volume, 3);

  const config = decodeScannerConfig(stored);
  assert.equal(config.volume, 3);
  assert.equal(config.oi4h, 28);
});

test("old envelopes and absent or malformed values safely use current defaults", () => {
  assert.equal(
    decodeScannerConfig({ schemaVersion: 1, values: { volume: 3 } }).volume,
    10,
  );
  assert.equal(decodeScannerConfig({}).volume, 10);
  assert.equal(decodeScannerConfig({ volume: "not-a-number", oi1h: -1 }).volume, 10);
  assert.equal(decodeScannerConfig({ volume: "not-a-number", oi1h: -1 }).oi1h, 15);
});
