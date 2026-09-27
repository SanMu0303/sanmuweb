export const TIMEFRAMES = ["15m", "1H", "4H", "1D"];
export const SECONDS = { "15m": 900, "1H": 3600, "4H": 14400, "1D": 86400 };

// The scanner config lives in the terminal's existing localStorage namespace.
// Keep a schema marker inside the stored config so a product-default change is
// applied once, without overwriting a value a user sets afterwards.
export const CONFIG_SCHEMA_VERSION = 2;
const LEGACY_DEFAULT_VOLUME = 3;

export const DEFAULTS = {
  minQuoteVolumeM: 5,
  maxVolumeRank: 0,
  // A volume event is only useful when it is materially outside the normal
  // candle range. The scanner compares the active candle with the twenty
  // preceding candles, never with itself.
  volume: 10,
  oi1h: 15,
  oi4h: 25,
  price1h: 8,
  price4h: 12,
  price24h: 20,
  cooldown: 45,
};

const CONFIG_KEYS = Object.keys(DEFAULTS);
const ALLOW_ZERO = new Set(["minQuoteVolumeM", "maxVolumeRank"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidValue(key, value) {
  if (!Number.isFinite(value)) return false;
  if (ALLOW_ZERO.has(key) ? value < 0 : value <= 0) return false;
  if (key === "maxVolumeRank" && !Number.isInteger(value)) return false;
  if (key === "cooldown" && (value < 30 || value > 1440)) return false;
  return true;
}

function persistedValues(value) {
  if (!isRecord(value)) return {};
  const parsed = {};
  for (const key of CONFIG_KEYS) {
    if (value[key] === undefined || value[key] === null || value[key] === "") continue;
    const number = Number(value[key]);
    if (isValidValue(key, number)) parsed[key] = number;
  }
  return parsed;
}

/**
 * Decode and migrate the browser-persisted scanner config.
 *
 * Versions before v2 stored a plain object and used 3x as the default volume
 * threshold. Upgrade that exact legacy default to 10x once. Other old values
 * are treated as deliberate choices. After the first write, `schemaVersion`
 * makes values such as a newly chosen 3x threshold unambiguous and preserves
 * them on future loads.
 */
export function decodeScannerConfig(stored) {
  const envelope = isRecord(stored) && Object.hasOwn(stored, "values");
  const version = envelope ? Number(stored.schemaVersion) || 0 : 0;
  const raw = envelope ? stored.values : stored;
  const values = persistedValues(raw);

  if (version < CONFIG_SCHEMA_VERSION && Number(raw?.volume) === LEGACY_DEFAULT_VOLUME) {
    values.volume = DEFAULTS.volume;
  }

  return { ...DEFAULTS, ...values };
}

/** Persist only supported numeric fields together with the schema marker. */
export function encodeScannerConfig(config) {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    values: validateConfig(config),
  };
}

export function validateConfig(input = {}) {
  const source = isRecord(input) ? input : {};
  const c = { ...DEFAULTS };
  for (const k of CONFIG_KEYS) {
    if (source[k] !== undefined) {
      const v = Number(source[k]);
      if (!Number.isFinite(v) || (ALLOW_ZERO.has(k) ? v < 0 : v <= 0)) {
        throw Error("无效阈值: " + k);
      }
      if (k === "maxVolumeRank" && !Number.isInteger(v)) {
        throw Error("成交额排名须为非负整数");
      }
      if (k === "cooldown" && (v < 30 || v > 1440)) {
        throw Error("冷却时间须为 30–1440 分钟");
      }
      c[k] = v;
    }
  }
  return c;
}
