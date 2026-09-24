export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type SignalKind = 'new_high' | 'new_low' | 'volume' | 'breakout' | 'breakdown' | 'price_move' | 'oi';

export type SignalItem = {
  id: string;
  kind: SignalKind;
  symbol: string;
  createdAt: number;
  title: string;
  detail: string;
  severity: 'info' | 'notice' | 'warning';
  price?: number;
};

export type TerminalSettings = {
  symbol: string;
  interval: string;
  minVolume: number;
  minOiValue: number;
  rankLimit: number;
  soundEnabled: boolean;
  soundVolume: number;
  watchlist: string[];
  plan: {symbol: string; thesis: string; entry: string; invalidation: string; note: string};
};

export const defaultTerminalSettings: TerminalSettings = {
  symbol: 'BTCUSDT',
  interval: '15m',
  minVolume: 5_000_000,
  minOiValue: 0,
  rankLimit: 50,
  soundEnabled: false,
  soundVolume: 0.35,
  watchlist: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  plan: {symbol: '', thesis: '', entry: '', invalidation: '', note: ''},
};

export const intervalLabels: Record<string, string> = {
  '1m': '1 分钟', '3m': '3 分钟', '5m': '5 分钟', '15m': '15 分钟', '30m': '30 分钟',
  '1h': '1 小时', '2h': '2 小时', '4h': '4 小时', '6h': '6 小时', '8h': '8 小时', '12h': '12 小时', '1d': '日线', '3d': '3 日线', '1w': '周线',
};

export const signalLabels: Record<SignalKind, string> = {
  new_high: '阶段新高',
  new_low: '阶段新低',
  volume: '成交量异常',
  breakout: '区间向上突破',
  breakdown: '区间向下跌破',
  price_move: '价格异动',
  oi: '持仓量异动',
};

export function compactNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const unit = units.find(([threshold]) => abs >= threshold);
  if (unit) return `${(value / unit[0]).toFixed(abs >= unit[0] * 100 ? 0 : digits)}${unit[1]}`;
  return value.toLocaleString('en-US', {maximumFractionDigits: digits});
}

export function priceNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = value >= 1_000 ? 2 : value >= 1 ? 4 : 7;
  return value.toLocaleString('en-US', {maximumFractionDigits: digits});
}

function average(items: number[]) {
  if (!items.length) return 0;
  return items.reduce((sum, value) => sum + value, 0) / items.length;
}

function id(kind: SignalKind, symbol: string, time: number) {
  return `${kind}:${symbol}:${time}`;
}

export function deriveSignals(candles: Candle[], symbol: string, oiValue?: number | null, previousOiValue?: number | null): SignalItem[] {
  if (candles.length < 8) return [];
  const latest = candles.at(-1)!;
  const previous = candles.slice(0, -1);
  const recent = previous.slice(-60);
  const rangeHigh = Math.max(...recent.map(candle => candle.high));
  const rangeLow = Math.min(...recent.map(candle => candle.low));
  const volumeBase = average(previous.slice(-25).map(candle => candle.volume));
  const priorClose = previous.at(-1)?.close || latest.open;
  const move = priorClose ? ((latest.close - priorClose) / priorClose) * 100 : 0;
  const signals: SignalItem[] = [];
  if (latest.high > rangeHigh && latest.close >= rangeHigh) signals.push({id: id('new_high', symbol, latest.time), kind: 'new_high', symbol, createdAt: latest.closeTime, title: `${symbol} 阶段新高`, detail: `最新收盘突破前 60 根 K 线高点 ${priceNumber(rangeHigh)}`, severity: 'notice', price: latest.close});
  if (latest.low < rangeLow && latest.close <= rangeLow) signals.push({id: id('new_low', symbol, latest.time), kind: 'new_low', symbol, createdAt: latest.closeTime, title: `${symbol} 阶段新低`, detail: `最新收盘跌破前 60 根 K 线低点 ${priceNumber(rangeLow)}`, severity: 'warning', price: latest.close});
  if (volumeBase > 0 && latest.volume >= volumeBase * 2.5) signals.push({id: id('volume', symbol, latest.time), kind: 'volume', symbol, createdAt: latest.closeTime, title: `${symbol} 成交量异常`, detail: `本根成交量为近 25 根均值 ${(latest.volume / volumeBase).toFixed(1)} 倍`, severity: 'notice', price: latest.close});
  if (Math.abs(move) >= 1) signals.push({id: id('price_move', symbol, latest.time), kind: 'price_move', symbol, createdAt: latest.closeTime, title: `${symbol} 价格异动`, detail: `相对上一根 K 线 ${move > 0 ? '+' : ''}${move.toFixed(2)}%`, severity: Math.abs(move) >= 2.5 ? 'warning' : 'info', price: latest.close});
  if (oiValue && oiValue > 0 && previousOiValue && previousOiValue > 0) {
    const oiChange = ((oiValue - previousOiValue) / previousOiValue) * 100;
    if (Math.abs(oiChange) >= 5) signals.push({
      id: id('oi', symbol, latest.time), kind: 'oi', symbol, createdAt: latest.closeTime,
      title: `${symbol} 持仓量异动`, detail: `名义持仓量相对上一公开记录 ${oiChange > 0 ? '+' : ''}${oiChange.toFixed(2)}%`,
      severity: Math.abs(oiChange) >= 10 ? 'warning' : 'notice', price: latest.close,
    });
  }
  return signals;
}

export function mergeSignals(existing: SignalItem[], incoming: SignalItem[]) {
  const seen = new Set(existing.map(signal => signal.id));
  return [...incoming.filter(signal => !seen.has(signal.id)), ...existing].slice(0, 250);
}

export function isValidSymbol(value: string) {
  return /^[A-Z0-9]{2,20}USDT$/.test(value.trim().toUpperCase());
}

export function sanitizeSettings(value: unknown): TerminalSettings {
  const raw = value && typeof value === 'object' ? value as Partial<TerminalSettings> : {};
  const pickNumber = (candidate: unknown, fallback: number, min: number, max: number) => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
  const watchlist = Array.isArray(raw.watchlist) ? raw.watchlist.map(item => String(item).toUpperCase()).filter(isValidSymbol).filter((item, index, list) => list.indexOf(item) === index).slice(0, 30) : defaultTerminalSettings.watchlist;
  const plan = raw.plan && typeof raw.plan === 'object' ? raw.plan : defaultTerminalSettings.plan;
  return {
    symbol: isValidSymbol(String(raw.symbol || '')) ? String(raw.symbol).toUpperCase() : defaultTerminalSettings.symbol,
    interval: intervalLabels[String(raw.interval || '')] ? String(raw.interval) : defaultTerminalSettings.interval,
    minVolume: pickNumber(raw.minVolume, defaultTerminalSettings.minVolume, 0, 10_000_000_000),
    minOiValue: pickNumber(raw.minOiValue, 0, 0, 10_000_000_000),
    rankLimit: Math.round(pickNumber(raw.rankLimit, 50, 1, 500)),
    soundEnabled: raw.soundEnabled === true,
    soundVolume: pickNumber(raw.soundVolume, defaultTerminalSettings.soundVolume, 0, 1),
    watchlist: watchlist.length ? watchlist : defaultTerminalSettings.watchlist,
    plan: {
      symbol: String(plan.symbol || '').slice(0, 24).toUpperCase(),
      thesis: String(plan.thesis || '').slice(0, 800),
      entry: String(plan.entry || '').slice(0, 300),
      invalidation: String(plan.invalidation || '').slice(0, 300),
      note: String(plan.note || '').slice(0, 800),
    },
  };
}
