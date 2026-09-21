"use client";

import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from "react";
import Link from "next/link";
import {Bell, BellOff, ChevronDown, ChevronUp, ExternalLink, LockKeyhole, Plus, RefreshCw, RotateCcw, Rss, Search, Settings2, Sparkles, Volume2, VolumeX, X} from "lucide-react";
import TerminalChart from "@/components/TerminalChart";
import {request} from "@/lib/live";
import {addTerminalSource, collectNewNewsIds, moveTerminalPanel, normalizeTerminalSource, sanitizeTerminalPreferences, TERMINAL_DEFAULTS, TERMINAL_STORAGE_KEY, TerminalPanelId, TerminalPreferences, TerminalSource, TrackedWallet} from "@/lib/terminal-model";

type NewsItem = {id:string; title:string; summary:string; url:string; sourceId:string; sourceName:string; publishedAt:string};
type NewsResponse = {items:NewsItem[]; sources:Array<{id:string;name:string;url:string;status:string;message?:string}>; fetchedAt:string; pollInterval:number};
type ErrorWithStatus = Error & {status?:number};

const INTERVALS = ["1", "5", "15", "60", "240", "D", "W"];
const PANEL_NAMES: Record<TerminalPanelId, string> = {chart:"K线图", market:"全市场消息", selected:"自选消息", smart:"聪明钱监听"};

function formatTime(value:string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"}).format(date);
}

function panelPosition(order:TerminalPanelId[], panel:TerminalPanelId) { return order.indexOf(panel); }

function PanelHeader({panel, order, onMove}:{panel:TerminalPanelId; order:TerminalPanelId[]; onMove:(panel:TerminalPanelId,direction:-1|1)=>void}) {
  const index = panelPosition(order, panel);
  return <div className="terminal-panel-header">
    <div><span className="terminal-panel-kicker">{String(index + 1).padStart(2, "0")}</span><h2>{PANEL_NAMES[panel]}</h2></div>
    <div className="terminal-panel-tools" aria-label={`${PANEL_NAMES[panel]}布局操作`}>
      <button type="button" className="terminal-icon-button" disabled={index<=0} onClick={()=>onMove(panel,-1)} aria-label={`上移${PANEL_NAMES[panel]}`}><ChevronUp size={15}/></button>
      <button type="button" className="terminal-icon-button" disabled={index===order.length-1} onClick={()=>onMove(panel,1)} aria-label={`下移${PANEL_NAMES[panel]}`}><ChevronDown size={15}/></button>
    </div>
  </div>;
}

export default function TerminalWorkspace() {
  const [prefs, setPrefs] = useState<TerminalPreferences>(TERMINAL_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<"market"|"selected">("market");
  const [news, setNews] = useState<NewsResponse|null>(null);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState("");
  const [newsNotice, setNewsNotice] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [customKind, setCustomKind] = useState<"rss"|"x">("rss");
  const [customName, setCustomName] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [walletPlatform, setWalletPlatform] = useState<"hyperliquid"|"binance">("hyperliquid");
  const [walletName, setWalletName] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletNotice, setWalletNotice] = useState("");
  const [showSourceManager, setShowSourceManager] = useState(false);
  const previousNews = useRef<Set<string>|null>(null);
  const audioContext = useRef<AudioContext|null>(null);
  const prefsRef = useRef(prefs);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TERMINAL_STORAGE_KEY);
      if (stored) setPrefs(sanitizeTerminalPreferences(JSON.parse(stored)));
      setSoundEnabled(window.localStorage.getItem("sanmu-terminal-sound") === "on");
    } catch { /* local preferences are optional */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    prefsRef.current = prefs;
    if (hydrated) window.localStorage.setItem(TERMINAL_STORAGE_KEY, JSON.stringify(prefs));
  }, [hydrated, prefs]);

  const playBeep = useCallback(() => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContext.current || new AudioContextClass();
      audioContext.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.28);
    } catch { /* browsers can reject audio until a user gesture */ }
  }, [soundEnabled]);

  const fetchNews = useCallback(async (sourceOverride?:TerminalSource[]) => {
    const sources = sourceOverride ?? prefsRef.current.sources.filter(source=>source.enabled);
    setNewsLoading(true); setNewsError("");
    try {
      const result = sources.length
        ? await request<NewsResponse>("/api/terminal/news", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({sources:sources.map(({id,kind,name,address})=>({id,kind,name,address}))})})
        : await request<NewsResponse>("/api/terminal/news");
      const previous = previousNews.current;
      if (previous && collectNewNewsIds(previous, result.items).length) playBeep();
      previousNews.current = new Set(result.items.map(item=>item.id));
      setNews(result); setNewsNotice("");
    } catch (error) {
      const typed = error as ErrorWithStatus;
      setNewsError(typed.message || "消息暂时无法加载");
      if (typed.status === 401) setNewsNotice("登录后可以同步自选消息来源；当前仍可查看全市场消息。");
    } finally { setNewsLoading(false); }
  }, [playBeep]);

  useEffect(() => {
    if (!hydrated) return;
    void fetchNews();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void fetchNews(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [fetchNews, hydrated]);

  useEffect(() => () => { audioContext.current?.close().catch(()=>{}); }, []);

  function changePrefs(update:Partial<TerminalPreferences>) { setPrefs(current=>({...current,...update})); }
  function movePanel(panel:TerminalPanelId, direction:-1|1) {
    setPrefs(current => { const index=current.order.indexOf(panel); return {...current, order:moveTerminalPanel(current.order,index,index+direction)}; });
  }
  function toggleSound() {
    const next=!soundEnabled; setSoundEnabled(next); window.localStorage.setItem("sanmu-terminal-sound", next ? "on" : "off");
    if (next) playBeep();
  }
  function resizeChart(event:React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY=event.clientY; const startHeight=prefsRef.current.chartHeight;
    const move=(next:PointerEvent)=>{ const height=Math.min(760,Math.max(420,startHeight+next.clientY-startY)); setPrefs(current=>({...current,chartHeight:height})); };
    const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); };
    window.addEventListener("pointermove",move); window.addEventListener("pointerup",up,{once:true});
  }

  async function submitSource(event:FormEvent) {
    event.preventDefault(); setNewsNotice("");
    const source=normalizeTerminalSource({kind:customKind,name:customName,address:customAddress});
    if (!source) { setNewsNotice(customKind === "x" ? "请输入 X 用户名或主页地址。" : "请输入安全的 HTTPS RSS 地址。"); return; }
    const next=addTerminalSource(prefsRef.current.sources,source);
    changePrefs({sources:next}); setCustomName(""); setCustomAddress(""); setShowSourceManager(false);
    try { await fetchNews(next); } catch { /* fetchNews already presents the error */ }
  }
  function removeSource(source:TerminalSource) { changePrefs({sources:prefs.sources.filter(item=>item.id!==source.id)}); }
  function submitWallet(event:FormEvent) {
    event.preventDefault();
    const address=walletAddress.trim();
    if (address.length<6) { setWalletNotice("请输入账户地址或标识。"); return; }
    const wallet:TrackedWallet={id:`${walletPlatform}-${Date.now()}`,platform:walletPlatform,name:walletName.trim()||"未命名账户",address};
    changePrefs({wallets:[...prefs.wallets,wallet].slice(0,12)}); setWalletName(""); setWalletAddress(""); setWalletNotice("已保存到本设备，等待接入实时账户数据。");
  }
  function removeWallet(wallet:TrackedWallet) { changePrefs({wallets:prefs.wallets.filter(item=>item.id!==wallet.id)}); }
  function resetLayout() { setPrefs(current=>({...TERMINAL_DEFAULTS,symbol:current.symbol,interval:current.interval,sources:current.sources,wallets:current.wallets})); }

  const displayItems=useMemo(()=>activeTab === "market" ? news?.items ?? [] : (news?.items ?? []).filter(item=>prefs.sources.some(source=>source.id===item.sourceId)),[activeTab,news,prefs.sources]);

  function renderNewsList(items:NewsItem[]) {
    if (newsLoading && !news) return <div className="terminal-empty"><RefreshCw size={17} className="terminal-spin"/>正在拉取消息</div>;
    if (!items.length) return <div className="terminal-empty"><Rss size={17}/><span>{activeTab === "selected" ? "还没有自选消息，添加一个 RSS 或 X 来源。" : "暂无可用消息，来源恢复后会自动更新。"}</span></div>;
    return <div className="terminal-news-list">{items.map(item=><article className="terminal-news-item" key={item.id}>
      <div className="terminal-news-meta"><span>{item.sourceName}</span><time dateTime={item.publishedAt}>{formatTime(item.publishedAt)}</time></div>
      <a href={item.url || "#"} target={item.url ? "_blank" : undefined} rel={item.url ? "noopener noreferrer nofollow" : undefined}>{item.title}<ExternalLink size={13} aria-hidden="true"/></a>
      {item.summary && <p>{item.summary}</p>}
    </article>)}</div>;
  }

  function renderPanel(panel:TerminalPanelId) {
    const header=<PanelHeader panel={panel} order={prefs.order} onMove={movePanel}/>;
    if (panel === "chart") return <section className="terminal-panel terminal-panel-chart" key={panel}>{header}<div className="terminal-chart-toolbar">
      <label><Search size={15}/><span className="sr-only">搜索交易品种</span><input value={prefs.symbol} onChange={event=>changePrefs({symbol:event.target.value.toUpperCase()})} onKeyDown={event=>{if(event.key==="Enter") event.currentTarget.blur()}} placeholder="BINANCE:BTCUSDT"/></label>
      <div className="terminal-intervals" role="group" aria-label="K线周期">{INTERVALS.map(interval=><button type="button" key={interval} className={prefs.interval===interval?"active":""} onClick={()=>changePrefs({interval})}>{interval === "D" ? "日线" : interval === "W" ? "周线" : `${interval}m`}</button>)}</div>
      <button type="button" className="terminal-text-button" onClick={()=>changePrefs({symbol:"BINANCE:BTCUSDT"})}>BTC</button>
    </div><div className="terminal-chart-frame" style={{"--terminal-chart-height":`${prefs.chartHeight}px`} as React.CSSProperties}><TerminalChart symbol={prefs.symbol} interval={prefs.interval}/></div><div className="terminal-resize-handle" onPointerDown={resizeChart} role="separator" aria-label="拖动调整图表高度" tabIndex={0}/><p className="terminal-panel-note">支持 TradingView 全市场搜索；图表仅提供行情研究，不包含下单操作。</p></section>;
    if (panel === "market") return <section className="terminal-panel" key={panel}>{header}<div className="terminal-news-tabs"><button type="button" className={activeTab==="market"?"active":""} onClick={()=>setActiveTab("market")}>全市场消息</button><button type="button" className={activeTab==="selected"?"active":""} onClick={()=>setActiveTab("selected")}>自选消息{prefs.sources.length ? ` · ${prefs.sources.length}` : ""}</button><button type="button" className="terminal-refresh" onClick={()=>void fetchNews()} aria-label="刷新消息"><RefreshCw size={14}/></button></div>{newsError && <p className="terminal-inline-error">{newsError}</p>}{newsNotice && <p className="terminal-inline-note">{newsNotice}</p>}{renderNewsList(displayItems)}</section>;
    if (panel === "selected") return <section className="terminal-panel" key={panel}>{header}<div className="terminal-panel-intro"><span>RSS / X 两类来源</span><button type="button" className="terminal-small-button" onClick={()=>setShowSourceManager(value=>!value)}><Settings2 size={14}/>{showSourceManager?"收起管理":"管理来源"}</button></div>{showSourceManager && <form className="terminal-source-form" onSubmit={submitSource}><div className="terminal-form-row"><select value={customKind} onChange={event=>setCustomKind(event.target.value as "rss"|"x")} aria-label="来源类型"><option value="rss">RSS 地址</option><option value="x">X 用户</option></select><input value={customName} onChange={event=>setCustomName(event.target.value)} placeholder="来源名称（可选）"/></div><input value={customAddress} onChange={event=>setCustomAddress(event.target.value)} placeholder={customKind === "x" ? "@username 或 x.com/username" : "https://example.com/feed.xml"} required/><div className="terminal-form-actions"><button type="submit" className="terminal-primary-button"><Plus size={15}/>添加来源</button><span>最多 8 个，服务端会校验地址安全性。</span></div></form>}<div className="terminal-source-list">{prefs.sources.length ? prefs.sources.map(source=><div className="terminal-source-chip" key={source.id}><span>{source.kind === "x" ? "𝕏" : <Rss size={13}/>} {source.name}</span><button type="button" onClick={()=>removeSource(source)} aria-label={`移除${source.name}`}><X size={13}/></button></div>) : <p className="terminal-muted">还没有来源，添加后会在这里聚合指定消息。</p>}</div>{activeTab!=="selected" && <button type="button" className="terminal-small-button terminal-open-selected" onClick={()=>setActiveTab("selected")}>查看自选消息</button>}</section>;
    return <section className="terminal-panel" key={panel}>{header}<div className="terminal-smart-placeholder"><div className="terminal-smart-icon"><Sparkles size={21}/></div><div><h3>Hype / Binance Smart Money</h3><p>监听入口已预留。接入账户数据后，这里会显示开仓、平仓、方向和时间线。</p></div></div><form className="terminal-wallet-form" onSubmit={submitWallet}><div className="terminal-form-row"><select value={walletPlatform} onChange={event=>setWalletPlatform(event.target.value as "hyperliquid"|"binance")} aria-label="平台"><option value="hyperliquid">Hyperliquid</option><option value="binance">Binance</option></select><input value={walletName} onChange={event=>setWalletName(event.target.value)} placeholder="账户名称（可选）"/></div><input value={walletAddress} onChange={event=>setWalletAddress(event.target.value)} placeholder="输入地址或账户标识" required/><div className="terminal-form-actions"><button type="submit" className="terminal-primary-button"><Plus size={15}/>添加监听入口</button><span>当前仅保存在本设备，不会发起交易。</span></div></form>{walletNotice && <p className="terminal-inline-note">{walletNotice}</p>}<div className="terminal-wallet-list">{prefs.wallets.map(wallet=><div className="terminal-wallet-row" key={wallet.id}><span><b>{wallet.name}</b><small>{wallet.platform === "hyperliquid" ? "Hype" : "Binance"} · {wallet.address}</small></span><button type="button" onClick={()=>removeWallet(wallet)} aria-label={`移除${wallet.name}`}><X size={13}/></button></div>)}</div></section>;
  }

  return <div className="terminal-workspace" style={{"--terminal-chart-height":`${prefs.chartHeight}px`} as React.CSSProperties}>
    <div className="terminal-overview"><div><span className="eyebrow">MARKET WORKBENCH</span><h1>交易终端</h1><p>把行情、消息和聪明钱线索放在同一个可调整的研究桌面。</p></div><div className="terminal-overview-actions"><button type="button" className={`terminal-sound-button ${soundEnabled?"enabled":""}`} onClick={toggleSound}>{soundEnabled?<Volume2 size={16}/>:<VolumeX size={16}/>} {soundEnabled?"提示音已开启":"开启提示音"}</button><button type="button" className="terminal-small-button" onClick={resetLayout}><RotateCcw size={14}/>重置布局</button></div></div>
    <div className="terminal-status-line"><span><span className="terminal-live-dot"/>消息每 60 秒更新</span><span>{news?.fetchedAt ? `上次更新 ${formatTime(news.fetchedAt)}` : "等待首次更新"}</span><Link href="/membership/">会员内容与研究记录 ↗</Link></div>
    <div className="terminal-layout">{prefs.order.map(renderPanel)}</div>
    <div className="terminal-footnote"><LockKeyhole size={14}/>消息来源会经过安全校验；自选来源需要登录后同步到服务器。<button type="button" onClick={()=>void fetchNews()}><RefreshCw size={13}/>立即刷新</button></div>
  </div>;
}
