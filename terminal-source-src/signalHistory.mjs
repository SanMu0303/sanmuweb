export const SIGNAL_HISTORY_CLEAR_STORAGE_KEY = "signal-history-cleared-at";

function timestampInMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

export function normalizeSignalHistoryClearedAt(value) {
  const timestamp = timestampInMilliseconds(value);
  return timestamp || 0;
}

export function signalDetectedAt(signal) {
  return (
    timestampInMilliseconds(signal?.detectedAt) ||
    timestampInMilliseconds(signal?.triggeredAt) ||
    null
  );
}

// A clear action is a client-side boundary: signals that had already been
// generated before it stay cleared, while any later real-time event can enter
// the queue normally. A signal must include a timestamp to cross that
// boundary; every supported scanner event already has one.
export function signalsAfterHistoryClear(signals, clearedAt) {
  const cutoff = normalizeSignalHistoryClearedAt(clearedAt);
  if (!cutoff) return Array.isArray(signals) ? signals : [];
  return (Array.isArray(signals) ? signals : []).filter((signal) => {
    const detectedAt = signalDetectedAt(signal);
    return detectedAt !== null && detectedAt > cutoff;
  });
}
