"use client";

import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, Bell, BellOff, BookOpen,
  Check, ChevronDown, Circle, Filter, LineChart, List, LoaderCircle, Pause,
  Play, Plus, Radio, RefreshCw, Search, Settings2, SlidersHorizontal, Trash2,
  Volume2, VolumeX, X,
} from 'lucide-react';
import MobileNavigationDrawer from '@/components/MobileNavigationDrawer';
import {useSiteTheme} from '@/components/SiteThemeProvider';
import type {SiteSession} from '@/components/SiteNavigation';
import {
  Candle, SignalItem, TerminalSettings, compactNumber, defaultTerminalSettings,
  deriveSignals, intervalLabels, isValidSymbol, mergeSignals, priceNumber,
  sanitizeSettings, signalLabels,
} from '@/lib/signal-terminal';

type Ticker = {
  symbol: string;
  lastPrice: number | null;
  priceChangePercent: number | null;
  quoteVolume: number | null;
  volume: number | null;
  highPrice: number | null;
  lowPrice: number | null;
};
type OpenInterestPoint = {time: number; openInterest: number | null; value: number | null};
type MarketSource = 'binance-usdm' | 'bybit-linear';
type Snapshot = {
  symbol: string;
  interval: string;
  candles: Candle[];
  ticker: Ticker;
  mark: {markPrice: number | null; fundingRate: number | null; nextFundingTime: number | null} | null;
  currentOi: {openInterest: number | null; time: number | null} | null;
  oiHistory: OpenInterestPoint[];
  rank: number | null;
  topByVolume: Ticker[];
  available: Record<string, boolean>;
  fetchedAt: string;
  source: MarketSource;
  sourceInterval?: string;
};
type CatalogItem = {symbol: string; baseAsset: string; quoteAsset: string; contractType: string};
type View = 'chart' | 'signals' | 'scanner' | 'plan';

const STORAGE_KEY = 'sanmu-signal-terminal-v1';
const MAX_CANDLES = 10_000;
const defaultSnapshot: Snapshot | null = null;

function normalizedSource(value?: MarketSource): MarketSource {
  return value === 'bybit-linear' ? 'bybit-linear' : 'binance-usdm';
}

function sourceName(source: MarketSource) {
  return source === 'bybit-linear' ? 'Bybit 线性永续' : '币安 USDT 永续';
}

function apiUrl(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  return `/api/terminal/data/?${search.toString()}`;
}

async function request<T>(params: Record<string, string | number | undefined>): Promise<T> {
  const response = await fetch(apiUrl(params), {cache: 'no-store'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '行情服务暂时不可用');
  return data as T;
}

function dateTime(value: number | string | null | undefined, withSeconds = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {hour: '2-digit', minute: '2-digit', ...(withSeconds ? {second: '2-digit'} : {})}).format(date);
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function volumeUsdt(snapshot: Snapshot | null) {
  if (!snapshot?.ticker.quoteVolume) return null;
  return snapshot.ticker.quoteVolume;
}

function currentOiValue(snapshot: Snapshot | null) {
  if (!snapshot?.currentOi?.openInterest) return null;
  const price = snapshot.mark?.markPrice || snapshot.ticker.lastPrice;
  return price ? snapshot.currentOi.openInterest * price : null;
}

function metricTone(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : '';
}

function Metric({label, value, hint, tone = ''}: {label: string; value: string; hint?: string; tone?: string}) {
  return <div className={`signal-terminal-metric ${tone}`.trim()}>
    <span>{label}</span>
    <strong>{value}</strong>
    {hint && <small>{hint}</small>}
  </div>;
}

function PriceChart({candles, oiHistory, symbol, interval, source, sourceInterval, loading}: {candles: Candle[]; oiHistory: OpenInterestPoint[]; symbol: string; interval: string; source: MarketSource; sourceInterval: string; loading: boolean}) {
  const width = 1200;
  const priceHeight = 330;
  const oiHeight = 88;
  const gap = 24;
  const height = priceHeight + gap + oiHeight;
  const pad = {top: 18, right: 80, bottom: 12, left: 12};
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = priceHeight - pad.top - pad.bottom;
  const low = candles.length ? Math.min(...candles.map(candle => candle.low)) : 0;
  const high = candles.length ? Math.max(...candles.map(candle => candle.high)) : 1;
  const range = Math.max(high - low, Math.max(Math.abs(high), 1) * 0.002);
  const step = candles.length ? plotWidth / candles.length : plotWidth;
  const body = Math.max(1, Math.min(10, step * 0.64));
  const y = (value: number) => pad.top + ((high - value) / range) * plotHeight;
  const oiIsNotional = source !== 'bybit-linear';
  const oiRows = oiHistory.filter(point => (oiIsNotional ? point.value : point.openInterest) !== null && point.time !== null);
  const oiValues = oiRows.map(point => (oiIsNotional ? point.value : point.openInterest) ?? 0);
  const oiMin = oiValues.length ? Math.min(...oiValues) : 0;
  const oiMax = oiValues.length ? Math.max(...oiValues) : 1;
  const oiRange = Math.max(oiMax - oiMin, 1);
  const oiLine = oiRows.map((point, index) => {
    const x = pad.left + (oiRows.length > 1 ? (index / (oiRows.length - 1)) * plotWidth : plotWidth / 2);
    const pointValue = (oiIsNotional ? point.value : point.openInterest) ?? 0;
    const pointY = priceHeight + gap + 8 + ((oiMax - pointValue) / oiRange) * (oiHeight - 18);
    return `${x.toFixed(1)},${pointY.toFixed(1)}`;
  }).join(' ');
  const last = candles.at(-1);
  const sourceHeading = source === 'bybit-linear' ? 'BYBIT LINEAR · 备用数据源' : 'BINANCE USDⓈ-M · LIVE';
  const intervalText = sourceInterval !== interval
    ? `${intervalLabels[sourceInterval] || sourceInterval} 原始周期（当前选择 ${intervalLabels[interval] || interval}）`
    : intervalLabels[interval] || interval;
  const note = source === 'bybit-linear'
    ? '当前由 Bybit 线性永续公开接口提供备用行情，每 30 秒刷新一次。系统会在 Binance 恢复可达后优先使用 Binance；Bybit OI 历史按持仓量展示。'
    : 'K 线来自币安 USDT 永续合约公开接口；实时更新来自浏览器直连的币安 WebSocket。OI 历史受交易所公开历史范围限制。';

  return <section className="signal-terminal-chart" aria-label={`${symbol} ${intervalText} K 线图，来源：${sourceName(source)}`}>
    <div className="signal-terminal-chart-head">
      <div><span className="signal-terminal-eyebrow">{sourceHeading}</span><strong>{symbol.replace('USDT', ' / USDT')}</strong><small>{intervalText} · 最近 {candles.length.toLocaleString()} 根</small></div>
      {last && <div className="signal-terminal-last"><span>最新</span><b>{priceNumber(last.close)}</b></div>}
    </div>
    <div className="signal-terminal-chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} K线与持仓量图`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="signal-terminal-oi" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#62d6ca" stopOpacity=".42"/><stop offset="1" stopColor="#62d6ca" stopOpacity="0"/></linearGradient>
        </defs>
        {[0, .25, .5, .75, 1].map((mark) => <line key={mark} className="signal-terminal-grid" x1={pad.left} x2={width - pad.right} y1={pad.top + mark * plotHeight} y2={pad.top + mark * plotHeight}/>) }
        {candles.map((candle, index) => {
          const x = pad.left + index * step + step / 2;
          const up = candle.close >= candle.open;
          const top = y(Math.max(candle.open, candle.close));
          const bottom = y(Math.min(candle.open, candle.close));
          return <g key={`${candle.time}-${index}`} className={up ? 'is-up' : 'is-down'}>
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} className="signal-terminal-wick"/>
            <rect x={x - body / 2} y={top} width={body} height={Math.max(1, bottom - top)} className="signal-terminal-candle"/>
          </g>;
        })}
        {last && <><line className="signal-terminal-price-line" x1={pad.left} x2={width - pad.right} y1={y(last.close)} y2={y(last.close)}/><text className="signal-terminal-price-label" x={width - pad.right + 8} y={y(last.close) + 4}>{priceNumber(last.close)}</text></>}
        <line className="signal-terminal-grid" x1={pad.left} x2={width - pad.right} y1={priceHeight + gap / 2} y2={priceHeight + gap / 2}/>
        <text className="signal-terminal-oi-label" x={pad.left} y={priceHeight + gap - 3}>{oiIsNotional ? 'OI · 名义持仓量' : 'OI · 持仓量'}</text>
        {oiLine && <><polyline className="signal-terminal-oi-line" points={oiLine}/><polyline className="signal-terminal-oi-fill" points={`${pad.left},${priceHeight + gap + oiHeight} ${oiLine} ${width - pad.right},${priceHeight + gap + oiHeight}`}/></>}
        {oiValues.length > 0 && <text className="signal-terminal-oi-value" x={width - pad.right + 8} y={priceHeight + gap + 18}>{compactNumber(oiValues.at(-1))}</text>}
      </svg>
      {!candles.length && <div className="signal-terminal-chart-empty">{loading ? <><LoaderCircle size={16} className="is-spinning"/> 正在读取行情 K 线…</> : '暂无 K 线数据'}</div>}
    </div>
    <p className="signal-terminal-chart-note">{note}</p>
  </section>;
}

function SignalCard({signal, onSelect, onRemove}: {signal: SignalItem; onSelect: (symbol: string) => void; onRemove: (id: string) => void}) {
  return <article className={`signal-card is-${signal.severity}`}>
    <button type="button" className="signal-card-main" onClick={() => onSelect(signal.symbol)}>
      <div className="signal-card-meta"><span>{signalLabels[signal.kind]}</span><time>{dateTime(signal.createdAt, true)}</time></div>
      <strong>{signal.title}</strong>
      <p>{signal.detail}</p>
      {signal.price !== undefined && <b className="signal-card-price">{priceNumber(signal.price)}</b>}
    </button>
    <button type="button" className="signal-card-dismiss" onClick={() => onRemove(signal.id)} aria-label={`忽略${signal.title}`}><X size={14}/></button>
  </article>;
}

function Watchlist({items, active, onSelect, onRemove, onAdd}: {items: string[]; active: string; onSelect: (symbol: string) => void; onRemove: (symbol: string) => void; onAdd: (symbol: string) => void}) {
  const [draft, setDraft] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const symbol = draft.trim().toUpperCase();
    if (isValidSymbol(symbol)) { onAdd(symbol); setDraft(''); }
  };
  return <section className="signal-terminal-panel signal-terminal-watchlist">
    <div className="signal-terminal-panel-head"><div><span>WATCHLIST</span><h2>观察池</h2></div><Circle size={14}/></div>
    <div className="signal-watchlist-items">
      {items.map(symbol => <div className={`signal-watchlist-row ${symbol === active ? 'is-active' : ''}`} key={symbol}>
        <button type="button" onClick={() => onSelect(symbol)}>{symbol.replace('USDT', '')}<small>/ USDT</small></button>
        <button type="button" onClick={() => onRemove(symbol)} aria-label={`移除${symbol}`}><X size={13}/></button>
      </div>)}
    </div>
    <form onSubmit={submit} className="signal-watchlist-add"><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="例如 DOGEUSDT" aria-label="添加交易对"/><button type="submit" aria-label="添加观察交易对"><Plus size={14}/></button></form>
  </section>;
}

function PlanPanel({settings, onChange}: {settings: TerminalSettings; onChange: (next: TerminalSettings) => void}) {
  const plan = settings.plan;
  const update = (field: keyof TerminalSettings['plan'], value: string) => onChange({...settings, plan: {...plan, [field]: value}});
  return <section className="signal-terminal-panel signal-terminal-plan">
    <div className="signal-terminal-panel-head"><div><span>EXECUTION PLAN</span><h2>交易计划</h2></div><BookOpen size={14}/></div>
    <div className="signal-terminal-plan-form">
      <label>标的<input value={plan.symbol} onChange={event => update('symbol', event.target.value)} placeholder="BTCUSDT"/></label>
      <label>判断<textarea value={plan.thesis} onChange={event => update('thesis', event.target.value)} placeholder="记录可复核的判断，不构成自动下单。"/></label>
      <div className="signal-terminal-plan-grid"><label>关注条件<input value={plan.entry} onChange={event => update('entry', event.target.value)} placeholder="等待条件"/></label><label>失效条件<input value={plan.invalidation} onChange={event => update('invalidation', event.target.value)} placeholder="风险条件"/></label></div>
      <label>备注<textarea value={plan.note} onChange={event => update('note', event.target.value)} placeholder="附加记录"/></label>
    </div>
  </section>;
}

function SettingsDrawer({settings, onChange, onClose, onReset}: {settings: TerminalSettings; onChange: (next: TerminalSettings) => void; onClose: () => void; onReset: () => void}) {
  const [volume, setVolume] = useState(String(settings.minVolume));
  const [oi, setOi] = useState(String(settings.minOiValue));
  const [rank, setRank] = useState(String(settings.rankLimit));
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);
  const apply = () => {
    onChange({...settings, minVolume: Math.max(0, Number(volume) || 0), minOiValue: Math.max(0, Number(oi) || 0), rankLimit: Math.max(1, Math.min(500, Number(rank) || 50))});
    onClose();
  };
  return <div className="signal-terminal-settings-backdrop" role="presentation" onMouseDown={event => {if (event.target === event.currentTarget) onClose();}}>
    <aside className="signal-terminal-settings" role="dialog" aria-modal="true" aria-label="扫描设置">
      <header><div><span>SCAN CONTROL</span><h2>扫描设置</h2></div><button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭设置"><X size={18}/></button></header>
      <p>筛选只控制新信号和语音提醒，不会删除既有记录。</p>
      <label>最低 24H 成交额（USDT）<input inputMode="decimal" value={volume} onChange={event => setVolume(event.target.value)}/></label>
      <label>最低名义持仓量（USDT，可设为 0）<input inputMode="decimal" value={oi} onChange={event => setOi(event.target.value)}/></label>
      <label>成交额排名上限<input inputMode="numeric" value={rank} onChange={event => setRank(event.target.value)}/></label>
      <div className="signal-terminal-settings-actions"><button type="button" onClick={apply} className="is-primary"><Check size={14}/>保存设置</button><button type="button" onClick={onReset}>恢复默认</button></div>
      <small>只读取公开的 USDT 永续合约行情。股票、大宗商品或其他数据源需要单独接入，当前不会用模拟行情代替。</small>
    </aside>
  </div>;
}

export default function SignalTerminalWorkspace() {
  const {theme} = useSiteTheme();
  const [session, setSession] = useState<(SiteSession & {id?: string}) | null>(null);
  const [settings, setSettings] = useState<TerminalSettings>(defaultTerminalSettings);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(defaultSnapshot);
  const [symbols, setSymbols] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline' | 'fallback'>('connecting');
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [signalFilter, setSignalFilter] = useState<'all' | 'notice' | 'warning'>('all');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [activeView, setActiveView] = useState<View>('chart');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanner, setScanner] = useState({running: false, done: 0, total: 0, lastRun: 0, notice: ''});
  const [audioActive, setAudioActive] = useState(false);
  const [liveSignalVersion, setLiveSignalVersion] = useState(0);
  const signalsRef = useRef<SignalItem[]>([]);
  const liveSignalRef = useRef<{symbol: string; interval: string; time: number; shouldAlert: boolean} | null>(null);
  const fallbackLatestRef = useRef<{symbol: string; interval: string; time: number} | null>(null);
  const snapshotRequestRef = useRef(0);
  const hydratingStorageKeyRef = useRef<string | null>(null);

  const changeSettings = useCallback((next: TerminalSettings) => setSettings(sanitizeSettings(next)), []);
  const symbol = settings.symbol;
  const interval = settings.interval;
  const storageKey = session?.signedIn && session.id ? `${STORAGE_KEY}:${session.id}` : STORAGE_KEY;

  useEffect(() => {
    let active = true;
    void window.fetch('/api/session', {cache: 'no-store'}).then(async response => response.ok ? await response.json() : {signedIn: false})
      .then(current => { if (active) setSession(current); })
      .catch(() => { if (active) setSession({signedIn: false}); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session === null) return;
    hydratingStorageKeyRef.current = storageKey;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setSettings(sanitizeSettings(JSON.parse(stored)));
    } catch { /* ignore malformed local preferences */ }
  }, [session, storageKey]);

  useEffect(() => {
    if (session === null) return;
    if (hydratingStorageKeyRef.current === storageKey) {
      hydratingStorageKeyRef.current = null;
      return;
    }
    try { window.localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* browser storage can be unavailable */ }
  }, [session, settings, storageKey]);

  useEffect(() => { signalsRef.current = signals; }, [signals]);

  const loadCatalog = useCallback(async () => {
    try {
      const data = await request<{symbols: CatalogItem[]}>({action: 'catalog'});
      setSymbols(data.symbols || []);
    } catch { /* catalog is optional to the chart */ }
  }, []);

  const loadSnapshot = useCallback(async () => {
    const requestId = ++snapshotRequestRef.current;
    setLoading(true);
    try {
      const data = await request<Snapshot>({action: 'snapshot', symbol, interval, limit: 1000});
      if (requestId !== snapshotRequestRef.current || data.symbol !== symbol || data.interval !== interval) return;
      const latestTime = data.candles.at(-1)?.time;
      const previousFallback = fallbackLatestRef.current;
      if (data.source === 'bybit-linear' && latestTime && previousFallback?.symbol === symbol && previousFallback.interval === interval && previousFallback.time !== latestTime) {
        liveSignalRef.current = {symbol, interval, time: latestTime, shouldAlert: false};
        setLiveSignalVersion(current => current + 1);
      }
      if (latestTime) fallbackLatestRef.current = {symbol, interval, time: latestTime};
      setSnapshot(data);
      setError('');
    } catch (reason) {
      if (requestId !== snapshotRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : '行情服务暂时不可用');
    } finally {
      if (requestId === snapshotRequestRef.current) setLoading(false);
    }
  }, [symbol, interval]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadSnapshot(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadSnapshot]);

  useEffect(() => {
    const snapshotIsCurrent = snapshot?.symbol === symbol && snapshot?.interval === interval;
    const source = normalizedSource(snapshot?.source);
    if (!snapshotIsCurrent) {
      setConnection('connecting');
      return;
    }
    if (source === 'bybit-linear') {
      setConnection('fallback');
      return;
    }

    let disposed = false;
    let retry = 0;
    let firstMessage = true;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (disposed) return;
      setConnection(retry ? 'reconnecting' : 'connecting');
      try { socket = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`); }
      catch { setConnection('offline'); return; }
      socket.onopen = () => { retry = 0; firstMessage = true; setConnection('live'); };
      socket.onmessage = (event) => {
        try {
          if (disposed) return;
          const message = JSON.parse(String(event.data));
          const row = message?.k;
          if (!row || row.s !== symbol) return;
          const candle: Candle = {time: Number(row.t), open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c), volume: Number(row.v), closeTime: Number(row.T)};
          if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) return;
          const isInitialMessage = firstMessage;
          firstMessage = false;
          setSnapshot(current => {
            if (!current || current.symbol !== symbol || current.interval !== interval || normalizedSource(current.source) !== 'binance-usdm') return current;
            const previous = current.candles;
            const latest = previous.at(-1);
            const candles = latest?.time === candle.time ? [...previous.slice(0, -1), candle] : [...previous, candle].slice(-MAX_CANDLES);
            return {...current, candles, ticker: {...current.ticker, lastPrice: candle.close}};
          });
          if (!isInitialMessage) {
            liveSignalRef.current = {symbol, interval, time: candle.time, shouldAlert: true};
            setLiveSignalVersion(current => current + 1);
          }
        } catch { /* malformed messages are ignored */ }
      };
      socket.onerror = () => setConnection('offline');
      socket.onclose = () => {
        if (disposed) return;
        setConnection('reconnecting');
        const delay = Math.min(20_000, 1_000 * 2 ** Math.min(5, retry++));
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => { disposed = true; if (reconnectTimer) window.clearTimeout(reconnectTimer); socket?.close(); };
  }, [symbol, interval, snapshot?.symbol, snapshot?.interval, snapshot?.source]);

  const speak = useCallback((text: string) => {
    if (!audioActive || !settings.soundEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.08;
    utterance.volume = settings.soundVolume;
    window.speechSynthesis.speak(utterance);
  }, [audioActive, settings.soundEnabled, settings.soundVolume]);

  useEffect(() => {
    const live = liveSignalRef.current;
    if (!live || !snapshot?.candles.length || snapshot.symbol !== live.symbol || snapshot.interval !== live.interval || snapshot.candles.at(-1)?.time !== live.time) return;
    const oiValue = currentOiValue(snapshot);
    const priorOiValue = snapshot.oiHistory.length > 1 ? snapshot.oiHistory.at(-2)?.value : null;
    const incoming = deriveSignals(snapshot.candles, snapshot.symbol, oiValue, priorOiValue)
      .filter(item => !signalsRef.current.some(current => current.id === item.id));
    if (!incoming.length) return;
    const canAlert = (snapshot.ticker.quoteVolume || 0) >= settings.minVolume
      && (oiValue || 0) >= settings.minOiValue
      && (!snapshot.rank || snapshot.rank <= settings.rankLimit);
    setSignals(current => mergeSignals(current, incoming));
    if (canAlert && live.shouldAlert) speak(`${incoming[0].symbol.replace('USDT', '')}，${signalLabels[incoming[0].kind]}`);
  }, [liveSignalVersion, snapshot, settings.minVolume, settings.minOiValue, settings.rankLimit, speak]);

  const selectSymbol = useCallback((candidate: string) => {
    const next = candidate.toUpperCase();
    if (!isValidSymbol(next)) return;
    changeSettings({...settings, symbol: next, watchlist: settings.watchlist.includes(next) ? settings.watchlist : [next, ...settings.watchlist].slice(0, 30)});
    setActiveView('chart');
  }, [changeSettings, settings]);

  const addWatch = useCallback((candidate: string) => {
    const next = candidate.toUpperCase();
    if (!isValidSymbol(next) || settings.watchlist.includes(next)) return;
    changeSettings({...settings, watchlist: [...settings.watchlist, next].slice(0, 30)});
  }, [changeSettings, settings]);

  const removeWatch = useCallback((candidate: string) => {
    const next = settings.watchlist.filter(item => item !== candidate);
    changeSettings({...settings, watchlist: next.length ? next : settings.watchlist});
  }, [changeSettings, settings]);

  const loadOlder = useCallback(async () => {
    const first = snapshot?.candles.at(0);
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await request<{candles: Candle[]; source?: MarketSource}>({action: 'candles', symbol, interval, limit: 1500, endTime: first.time - 1, source: snapshot?.source});
      if (data.candles?.length) setSnapshot(current => {
        if (!current || current.symbol !== symbol || current.interval !== interval || (data.source && normalizedSource(current.source) !== data.source)) return current;
        const ids = new Set(current.candles.map(candle => candle.time));
        const merged = [...data.candles.filter(candle => !ids.has(candle.time)), ...current.candles].slice(-MAX_CANDLES);
        return {...current, candles: merged};
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '更早 K 线读取失败'); }
    finally { setLoadingOlder(false); }
  }, [snapshot, loadingOlder, symbol, interval]);

  const runScan = useCallback(async () => {
    const candidates = (snapshot?.topByVolume || []).map((item, index) => ({...item, rank: index + 1}))
      .filter(item => (item.quoteVolume || 0) >= settings.minVolume && item.rank <= settings.rankLimit).slice(0, 20);
    if (!candidates.length || scanner.running) { setScanner(current => ({...current, notice: '等待行情列表后再执行扫描。'})); return; }
    setScanner({running: true, done: 0, total: candidates.length, lastRun: Date.now(), notice: ''});
    const results: SignalItem[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        const position = cursor++;
        const candidate = candidates[position];
        try {
          const [data, oi] = await Promise.all([
            request<{candles: Candle[]}>({action: 'candles', symbol: candidate.symbol, interval, limit: 80, source: snapshot?.source}),
            request<{openInterest: number | null}>({action: 'open-interest', symbol: candidate.symbol, source: snapshot?.source}),
          ]);
          const oiValue = oi.openInterest && candidate.lastPrice ? oi.openInterest * candidate.lastPrice : null;
          if (settings.minOiValue <= 0 || (oiValue !== null && oiValue >= settings.minOiValue)) {
            results.push(...deriveSignals(data.candles || [], candidate.symbol));
          }
        } catch { /* individual symbols can be unavailable */ }
        setScanner(current => ({...current, done: Math.min(current.total, current.done + 1)}));
      }
    };
    await Promise.all(Array.from({length: Math.min(4, candidates.length)}, () => worker()));
    setSignals(current => mergeSignals(current, results));
    setScanner(current => ({...current, running: false, notice: results.length ? `发现 ${results.length} 条符合条件的信号。` : '本轮没有符合当前规则的新信号。'}));
  }, [interval, scanner.running, settings.minOiValue, settings.minVolume, settings.rankLimit, snapshot?.source, snapshot?.topByVolume]);

  const armSound = useCallback(() => {
    const nextActive = !audioActive;
    setAudioActive(nextActive);
    const next = {...settings, soundEnabled: nextActive};
    changeSettings(next);
    if (nextActive && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance('信号提醒已开启');
      utterance.lang = 'zh-CN';
      utterance.volume = settings.soundVolume;
      window.speechSynthesis.speak(utterance);
    }
  }, [audioActive, changeSettings, settings]);

  const testSound = useCallback(() => {
    if (!audioActive) { armSound(); return; }
    speak('这是交易信号提醒试听');
  }, [armSound, audioActive, speak]);

  const filteredSymbols = useMemo(() => {
    const query = symbolSearch.trim().toUpperCase();
    return (query ? symbols.filter(item => item.symbol.includes(query) || item.baseAsset.includes(query)) : symbols).slice(0, 24);
  }, [symbols, symbolSearch]);
  const visibleSignals = signalFilter === 'all' ? signals : signals.filter(item => item.severity === signalFilter);
  const oiValue = currentOiValue(snapshot);
  const selectedTicker = snapshot?.ticker;
  const selectedSource = normalizedSource(snapshot?.source);
  const selectedSourceName = sourceName(selectedSource);
  const selectedSourceInterval = snapshot?.sourceInterval || interval;
  const usingFallback = selectedSource === 'bybit-linear';
  const connectionLabel = connection === 'live' ? '实时推送已连接' : connection === 'fallback' ? '备用行情已加载 · 定时刷新' : connection === 'connecting' ? '正在连接行情' : connection === 'reconnecting' ? '正在重连行情' : '行情连接不可用';

  return <main className="signal-terminal" data-connection={connection}>
    <header className="signal-terminal-topbar">
      <div className="signal-terminal-brand"><MobileNavigationDrawer path="/terminal/" theme={theme} session={session} triggerClassName="signal-terminal-nav-toggle"/><Activity size={18}/><div><span>RESEARCH SIGNALS</span><strong>趋势交易信号工作台</strong></div></div>
      <div className="signal-terminal-top-center"><span className={`signal-terminal-connection is-${connection}`}><i/><b>{connectionLabel}</b></span><span>{usingFallback ? 'BYBIT LINEAR · 备用数据源' : 'BINANCE USDⓈ-M'}</span></div>
      <div className="signal-terminal-top-actions"><button type="button" className={audioActive ? 'is-active' : ''} onClick={armSound} aria-pressed={audioActive}>{audioActive ? <Volume2 size={15}/> : <VolumeX size={15}/>}<span>{audioActive ? '声音已开' : settings.soundEnabled ? '点击启用声音' : '开启声音'}</span></button><label className="signal-terminal-volume" title="提醒音量"><Volume2 size={13}/><input type="range" min="0" max="1" step="0.05" value={settings.soundVolume} onChange={event => changeSettings({...settings, soundVolume: Number(event.target.value)})} aria-label="提醒音量"/></label><button type="button" onClick={testSound} title="试听提示音"><Bell size={14}/><span>试听</span></button><button type="button" onClick={() => setSettingsOpen(true)}><Settings2 size={15}/><span>扫描设置</span></button><Link href="/"><ArrowLeft size={15}/><span>返回主站</span></Link></div>
    </header>

    <nav className="signal-terminal-mobile-tabs" aria-label="终端视图">
      {([{id: 'chart', label: '行情'}, {id: 'signals', label: '信号'}, {id: 'scanner', label: '扫描'}, {id: 'plan', label: '计划'}] as Array<{id: View; label: string}>).map(item => <button key={item.id} type="button" className={activeView === item.id ? 'is-active' : ''} onClick={() => setActiveView(item.id)}>{item.label}</button>)}
    </nav>

    <div className="signal-terminal-layout">
      <aside className={`signal-terminal-left ${activeView !== 'signals' ? 'mobile-hidden' : ''}`}>
        <section className="signal-terminal-panel signal-terminal-signal-list">
          <div className="signal-terminal-panel-head"><div><span>LIVE SIGNALS</span><h2>实时信号</h2></div><div className="signal-terminal-panel-actions"><button type="button" onClick={() => setSignalFilter(signalFilter === 'all' ? 'notice' : signalFilter === 'notice' ? 'warning' : 'all')} aria-label="切换信号筛选"><Filter size={14}/>{signalFilter === 'all' ? '全部' : signalFilter === 'notice' ? '关注' : '风险'}</button><span>{signals.length}</span></div></div>
          <div className="signal-terminal-signal-info"><Radio size={13}/><span>{connection === 'live' ? `当前图表正在接收 ${selectedSourceName} K 线更新` : connection === 'fallback' ? 'Bybit 备用行情每 30 秒刷新一次；只为新增 K 线生成视觉信号，不混用 Binance 实时推送。' : '信号会在行情连接恢复后继续更新'}</span></div>
          <div className="signal-terminal-signal-scroll">
            {visibleSignals.length ? visibleSignals.map(item => <SignalCard key={item.id} signal={item} onSelect={selectSymbol} onRemove={(id) => setSignals(current => current.filter(signal => signal.id !== id))}/>) : <div className="signal-terminal-empty"><Bell size={18}/><strong>尚无信号</strong><p>选择标的后，系统会依据实时 K 线检测新高、新低、突破、成交量与价格异动。</p></div>}
          </div>
        </section>
        <Watchlist items={settings.watchlist} active={symbol} onSelect={selectSymbol} onRemove={removeWatch} onAdd={addWatch}/>
      </aside>

      <section className={`signal-terminal-market ${activeView !== 'chart' ? 'mobile-hidden' : ''}`}>
        <div className="signal-terminal-market-toolbar">
          <div className="signal-terminal-symbol-picker"><Search size={15}/><input value={symbolSearch} onChange={event => setSymbolSearch(event.target.value)} placeholder={symbol.replace('USDT', '')} aria-label="搜索 USDT 永续交易对"/><ChevronDown size={14}/>{symbolSearch && <div className="signal-terminal-symbol-menu">{filteredSymbols.length ? filteredSymbols.map(item => <button type="button" key={item.symbol} onClick={() => { selectSymbol(item.symbol); setSymbolSearch(''); }}>{item.symbol.replace('USDT', '')}<small>/ USDT 永续</small></button>) : <span>没有匹配的可交易 USDT 永续合约</span>}</div>}</div>
          <div className="signal-terminal-intervals">{Object.keys(intervalLabels).map(value => <button type="button" key={value} className={interval === value ? 'is-active' : ''} onClick={() => changeSettings({...settings, interval: value})}>{value}</button>)}</div>
          <button type="button" className="signal-terminal-refresh" onClick={() => void loadSnapshot()} aria-label="刷新行情"><RefreshCw size={15} className={loading ? 'is-spinning' : ''}/></button>
        </div>
        <section className="signal-terminal-metrics" aria-label="市场指标">
          <Metric label="24H 成交额" value={compactNumber(volumeUsdt(snapshot))} hint="USDT"/>
          <Metric label={usingFallback ? "当前 OI 估值" : "名义持仓量"} value={compactNumber(oiValue)} hint={usingFallback ? "按标记价格估算" : "USDT"}/>
          <Metric label="流通市值" value="待接入" hint="需可信供应数据"/>
          <Metric label="成交额排名" value={snapshot?.rank ? `#${snapshot.rank}` : '—'} hint={`${selectedSourceName} USDT 永续`}/>
          <Metric label="24H 涨跌幅" value={percent(selectedTicker?.priceChangePercent)} hint={selectedTicker?.highPrice ? `高 ${priceNumber(selectedTicker.highPrice)}` : '—'} tone={metricTone(selectedTicker?.priceChangePercent)}/>
        </section>
        {error && <div className="signal-terminal-error"><AlertTriangle size={15}/><span>{error}</span><button type="button" onClick={() => void loadSnapshot()}>重试</button></div>}
        <PriceChart candles={snapshot?.candles || []} oiHistory={snapshot?.oiHistory || []} symbol={symbol} interval={interval} source={selectedSource} sourceInterval={selectedSourceInterval} loading={loading}/>
        <div className="signal-terminal-history-bar"><span><HistoryIcon/>已加载 {snapshot?.candles.length.toLocaleString() || 0} 根 K 线</span><button type="button" onClick={() => void loadOlder()} disabled={loadingOlder || !snapshot?.candles.length}>{loadingOlder ? <><LoaderCircle size={13} className="is-spinning"/>读取中</> : <><ChevronDown size={13}/>加载更早历史</>}</button><span>{usingFallback ? "Bybit 单次公开接口最多 1,000 根" : "Binance 单次公开接口最多 1,500 根"}；本页最多保留 {MAX_CANDLES.toLocaleString()} 根。</span></div>
      </section>

      <aside className={`signal-terminal-right ${activeView === 'scanner' ? 'mobile-visible' : activeView === 'plan' ? 'mobile-plan' : ''}`}>
        <section className="signal-terminal-panel signal-terminal-scanner">
          <div className="signal-terminal-panel-head"><div><span>MARKET SCANNER</span><h2>全市场扫描</h2></div><button type="button" className={scanner.running ? 'is-working' : ''} onClick={() => void runScan()} disabled={scanner.running}>{scanner.running ? <LoaderCircle size={14} className="is-spinning"/> : <ScanIcon/>}{scanner.running ? `${scanner.done}/${scanner.total}` : '扫描前 20'}</button></div>
          <p className="signal-terminal-scanner-note">按 24H 成交额过滤，使用最多 4 个并发任务读取公开 K 线。不会将模拟结果标为实时信号。</p>
          <div className="signal-terminal-scan-rules"><span>≥ {compactNumber(settings.minVolume)} USDT</span><span>排名 ≤ {settings.rankLimit}</span>{settings.minOiValue > 0 && <span>OI ≥ {compactNumber(settings.minOiValue)}</span>}</div>
          {scanner.notice && <div className="signal-terminal-scanner-notice">{scanner.notice}</div>}
          <div className="signal-terminal-market-list">
            {(snapshot?.topByVolume || []).filter(item => (item.quoteVolume || 0) >= settings.minVolume).slice(0, 12).map((item, index) => <button type="button" key={item.symbol} className={item.symbol === symbol ? 'is-current' : ''} onClick={() => selectSymbol(item.symbol)}><span>#{index + 1}</span><b>{item.symbol.replace('USDT', '')}</b><small>{compactNumber(item.quoteVolume)}</small><em className={metricTone(item.priceChangePercent)}>{percent(item.priceChangePercent)}</em></button>)}
            {!snapshot?.topByVolume?.length && <div className="signal-terminal-empty small"><List size={16}/><p>等待永续市场 24H 成交额列表。</p></div>}
          </div>
        </section>
        <PlanPanel settings={settings} onChange={changeSettings}/>
      </aside>
    </div>

    {settingsOpen && <SettingsDrawer settings={settings} onChange={changeSettings} onClose={() => setSettingsOpen(false)} onReset={() => { changeSettings(defaultTerminalSettings); setSettingsOpen(false); }}/>}
  </main>;
}

function HistoryIcon() { return <LineChart size={13}/>; }
function ScanIcon() { return <BarChart3 size={14}/>; }
