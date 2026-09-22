"use client";

import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from "react";
import Link from "next/link";
import {ArrowLeft, Bell, BellOff, ChevronDown, ExternalLink, GripVertical, Headphones, LockKeyhole, Pause, Play, Plus, RefreshCw, RotateCcw, Search, Settings2, SlidersHorizontal, Volume2, VolumeX, X} from "lucide-react";
import TerminalChart, {TerminalChartStatus} from "@/components/TerminalChart";
import {request} from "@/lib/live";
import {readSiteTheme, writeSiteTheme, type SiteTheme} from "@/components/site-theme";
import {freshEvents, matchesReminder, mergeEvents} from "@/lib/terminal-alerts.mjs";
import {defaultCapabilities, defaultConfig, dateLabel, panelTitles, type Capabilities, type ConfigResponse, type Connection, type FeedResponse, type FollowAccount, type MonitorSource, type Panel, type Preferences, type SourceState, type TerminalEvent, type View} from "@/lib/terminal-workbench";

type Session = {signedIn:boolean; nickname?:string; isMember?:boolean; membership?:{status:string;expiresAt:string|null}};
type Err = Error & {status?:number};

const initialConfig = {...defaultConfig, preferences:{...defaultConfig.preferences, panelSound:{...defaultConfig.preferences.panelSound}}};
const mobileViews:View[] = ["chart", "market", "selected", "smart"];
const marketFilters = ["全部", "加密资产", "股票", "指数", "外汇", "商品"];

function queryString(params:Record<string,string|number|undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key,value]) => { if (value !== undefined && value !== "") search.set(key, String(value)); });
  const value = search.toString();
  return value ? `?${value}` : "";
}
function errorMessage(error:unknown) { return (error as Err)?.message || "请求失败，请稍后重试。"; }
function sourceStatus(sources:SourceState[]|undefined):Connection {
  if (!sources) return "connecting";
  if (!sources.length) return "unconfigured";
  if (sources.some(source=>source.status === "ok")) return "ok";
  if (sources.some(source=>source.status === "error")) return "error";
  if (sources.some(source=>source.status === "unconfigured")) return "unconfigured";
  return "disabled";
}
function connectionText(value:Connection) { return ({connecting:"连接中",ok:"已连接",error:"连接断开",unconfigured:"尚未配置",disabled:"已停用"} as Record<Connection,string>)[value]; }
function formatAgo(value:string) { const date = new Date(value); if (!value||!Number.isFinite(date.getTime())||date.getTime()<=0) return "时间未知"; return new Intl.DateTimeFormat("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(date); }
type RefreshReason = "initial" | "poll" | "manual" | "page";

function StatusPill({status}:{status:Connection}) { return <span className={`terminal-status terminal-status-${status}`}><i aria-hidden="true"/>{connectionText(status)}</span>; }

function FeedItem({item}:{item:TerminalEvent}) {
  return <article className="workbench-event">
    <div className="workbench-event-meta"><span className="workbench-source">{item.sourceName}</span><time dateTime={item.publishedAt}>{formatAgo(item.publishedAt)}</time></div>
    <a className="workbench-event-title" href={item.url || "#"} target={item.url ? "_blank" : undefined} rel={item.url ? "noopener noreferrer nofollow" : undefined}>{item.title || "未命名消息"}<ExternalLink size={12} aria-hidden="true"/></a>
    {item.summary && <p>{item.summary}</p>}
    <div className="workbench-event-tags">{item.market && <span>{item.market}</span>}{item.tags?.slice(0,3).map(tag=><span key={tag}>{tag}</span>)}</div>
  </article>;
}

type FeedFilters = {search:string;market:string;source:string;onSearch:(value:string)=>void;onMarket:(value:string)=>void;onSource:(value:string)=>void};
function FeedWindow({title,panel,feed,loading,error,paused,onPause,onLatest,newCount,onRefresh,onManage,showManage,sessionRequired,onScroll,scrollRef,soundEnabled,onSoundToggle,filters,onLoadMore,pageLoading}:{title:string;panel:Panel;feed:FeedResponse|null;loading:boolean;error:string;paused:boolean;onPause:()=>void;onLatest:()=>void;newCount:number;onRefresh:()=>void;onManage?:()=>void;showManage?:boolean;sessionRequired?:boolean;onScroll?:(event:React.UIEvent<HTMLDivElement>)=>void;scrollRef?:React.Ref<HTMLDivElement>;soundEnabled?:boolean;onSoundToggle?:()=>void;filters?:FeedFilters;onLoadMore:()=>void;pageLoading:boolean}) {
  const status = error ? "error" : sessionRequired ? "disabled" : sourceStatus(feed?.sources);
  return <section className={`workbench-window workbench-window-${panel}`} aria-label={title}>
    <header className="workbench-window-head"><div><div className="workbench-window-title"><span className="workbench-index">{panel === "market" ? "01" : panel === "selected" ? "02" : "03"}</span><h2>{title}</h2></div><div className="workbench-window-sub"><StatusPill status={status}/>{feed?.fetchedAt ? <span>更新 {formatAgo(feed.fetchedAt)}</span> : <span>等待数据</span>}</div></div><div className="workbench-window-actions"><button type="button" className="terminal-icon-button" onClick={onRefresh} aria-label={`刷新${title}`}><RefreshCw size={14}/></button>{onSoundToggle&&<button type="button" className={`terminal-icon-button ${soundEnabled?"is-active":""}`} onClick={onSoundToggle} aria-label={`${soundEnabled?"关闭":"开启"}${title}提示音`}>{soundEnabled?<Bell size={14}/>:<BellOff size={14}/>}</button>}{onManage&&<button type="button" className={showManage?"terminal-icon-button is-active":"terminal-icon-button"} onClick={onManage} aria-label="管理监听"><Settings2 size={14}/></button>}</div></header>
    {filters&&<div className="workbench-window-filterbar"><div className="terminal-filter-search"><Search size={13}/><input value={filters.search} onChange={event=>filters.onSearch(event.target.value)} placeholder="搜索标题、摘要或资产" aria-label={`${title}搜索`}/></div><select value={filters.market} onChange={event=>filters.onMarket(event.target.value)} aria-label={`${title}市场类别`}>{marketFilters.map(filter=><option key={filter}>{filter}</option>)}</select><select value={filters.source} onChange={event=>filters.onSource(event.target.value)} aria-label={`${title}来源筛选`}><option value="">全部来源</option>{(feed?.sources||[]).map(source=><option value={source.id} key={source.id}>{source.name}</option>)}</select></div>}
    {sessionRequired && <div className="workbench-login-note"><LockKeyhole size={14}/><span>登录后管理个人监听；未接入来源会明确显示状态。</span><Link href="/login/?next=/terminal/">登录</Link></div>}
    <div className="workbench-feed-tools"><span className="workbench-unread" aria-live="polite">{feed?.items.length || 0} 条</span><span className="workbench-tool-spacer"/>{newCount > 0 && <button type="button" className="workbench-new-button" onClick={onLatest}>有 {newCount} 条新消息</button>}<button type="button" className="terminal-tool-button" onClick={onPause}>{paused?<><Play size={12}/>继续</>:<><Pause size={12}/>暂停</>}</button></div>
    {error&&<div className="workbench-inline-error" role="alert">{error}</div>}
    {!feed && loading ? <div className="workbench-empty"><RefreshCw className="terminal-spin" size={16}/>正在读取</div> : !feed?.items.length ? <div className="workbench-empty"><Bell size={16}/><span>{status === "unconfigured" ? "尚未接入消息源" : "暂时没有匹配消息"}</span></div> : <div className="workbench-feed-scroll" ref={scrollRef} onScroll={onScroll}>{feed.items.map(item=><FeedItem key={item.id} item={item}/>)}{feed.nextCursor&&feed.items.length<300&&<div className="workbench-feed-tools"><button type="button" className="terminal-tool-button" onClick={onLoadMore} disabled={loading} aria-label={`加载${title}更早消息`}>{pageLoading?<><RefreshCw size={12} className="terminal-spin"/>加载中…</>:"加载更早消息"}</button></div>}{feed.items.length>=300&&<div className="workbench-feed-tools">已保留最近 300 条，请使用搜索缩小范围</div>}</div>}
  </section>;
}

function SourceManager({config,capabilities,onSave,onClose}:{config:ConfigResponse["config"];capabilities:Capabilities;onSave:(next:ConfigResponse["config"])=>Promise<void>;onClose:()=>void}) {
  const [kind,setKind] = useState<MonitorSource["kind"]>("rss");
  const [name,setName] = useState(""); const [address,setAddress] = useState(""); const [keywords,setKeywords] = useState(""); const [sound,setSound] = useState(true); const [editingId,setEditingId] = useState<string|null>(null); const [saving,setSaving] = useState(false); const [notice,setNotice] = useState("");
  const add = async (event:FormEvent) => { event.preventDefault(); setNotice(""); if (!address.trim()) { setNotice("请填写来源地址或账号。"); return; } const source:MonitorSource={id:editingId||`source-${Date.now().toString(36)}`,kind,name:name.trim()||"未命名来源",address:address.trim(),keywords,sound,enabled:editingId ? config.sources.find(item=>item.id===editingId)?.enabled!==false : true}; const nextSources=editingId?config.sources.map(item=>item.id===editingId?{...item,...source}:item):[...config.sources,source]; setSaving(true); try { await onSave({...config,sources:nextSources}); setName("");setAddress("");setKeywords("");setEditingId(null);setNotice(editingId?"已保存修改。":"已保存。实际监听状态请查看状态标签。"); } catch (e) { setNotice(errorMessage(e)); } finally { setSaving(false); } };
  const remove = async (id:string) => { const next=config.sources.filter(item=>item.id!==id); setSaving(true); try { await onSave({...config,sources:next}); } catch(e) {setNotice(errorMessage(e));} finally{setSaving(false);} };
  const toggle = async (source:MonitorSource) => { setSaving(true); try { await onSave({...config,sources:config.sources.map(item=>item.id===source.id?{...item,enabled:!item.enabled,requestedEnabled:!item.enabled}:item)}); } catch(e){setNotice(errorMessage(e));} finally{setSaving(false);} };
  const edit = (source:MonitorSource) => { setEditingId(source.id);setKind(source.kind);setName(source.name);setAddress(source.address);setKeywords(Array.isArray((source as unknown as {keywords?:unknown}).keywords)?((source as unknown as {keywords:string[]}).keywords).join(","):String(source.keywords||""));setSound(source.sound);setNotice(""); };
  const cancelEdit = () => { setEditingId(null);setName("");setAddress("");setKeywords("");setSound(true);setNotice(""); };
  return <div className="workbench-manager"><div className="workbench-manager-head"><div><span className="workbench-kicker">SOURCE CONTROL</span><h3>管理监听来源</h3></div><button type="button" className="terminal-icon-button" onClick={onClose} aria-label="关闭来源管理"><X size={16}/></button></div><form onSubmit={add} className="workbench-manager-form"><div className="workbench-form-grid"><label>对象类型<select value={kind} onChange={e=>setKind(e.target.value as MonitorSource["kind"])}><option value="rss">新闻源 URL（RSS）</option><option value="x" disabled={!capabilities.x}>社交账号（X）{!capabilities.x?" · 待接入":""}</option><option value="wallet" disabled={!capabilities.wallet}>链上钱包{!capabilities.wallet?" · 待接入":""}</option></select></label><label>名称 / 备注<input value={name} onChange={e=>setName(e.target.value)} placeholder="例如：官方公告"/></label></div><label>地址或账号<input value={address} onChange={e=>setAddress(e.target.value)} placeholder={kind === "rss"?"https://example.com/feed.xml":"@账号或公开地址"}/></label><label>关键词（可选）<input value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="逗号分隔"/></label><label className="workbench-check"><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/> 新消息播放提示音</label><div className="workbench-manager-actions"><button type="submit" className="workbench-primary" disabled={saving}><Plus size={14}/>{editingId?"保存修改":"保存监听配置"}</button>{editingId&&<button type="button" className="terminal-tool-button" onClick={cancelEdit}>取消编辑</button>}</div>{notice&&<p className="workbench-manager-notice">{notice}</p>}</form><div className="workbench-config-list">{config.sources.map(source=><div className="workbench-config-row" key={source.id}><div><b>{source.name}</b><small>{source.kind.toUpperCase()} · {source.address}</small></div><div className="workbench-config-row-actions"><button type="button" className="terminal-tool-button" disabled={saving} onClick={()=>edit(source)}>编辑</button><button type="button" disabled={saving||!capabilities[source.kind]} className={source.enabled?"is-enabled":""} onClick={()=>void toggle(source)}>{!capabilities[source.kind]?"待接入":source.enabled?"配置启用":"配置停用"}</button><button type="button" disabled={saving} onClick={()=>void remove(source.id)} aria-label={`删除${source.name}`}><X size={13}/></button></div></div>)}{!config.sources.length&&<p className="workbench-muted">还没有保存的监听来源。</p>}</div></div>;
}

function SmartManager({config,capabilities,onSave,onClose}:{config:ConfigResponse["config"];capabilities:Capabilities;onSave:(next:ConfigResponse["config"])=>Promise<void>;onClose:()=>void}) {
  const [platform,setPlatform]=useState<FollowAccount["platform"]>("hyperliquid"); const [name,setName]=useState(""); const [address,setAddress]=useState(""); const [notice,setNotice]=useState(""); const [saving,setSaving]=useState(false);
  const add=async(e:FormEvent)=>{e.preventDefault();if(!address.trim()){setNotice("请填写公开账户地址或标识。");return;}const wallet:FollowAccount={id:`wallet-${Date.now().toString(36)}`,platform,name:name.trim()||"未命名账户",address:address.trim(),enabled:true};setSaving(true);try{await onSave({...config,wallets:[...config.wallets,wallet]});setName("");setAddress("");setNotice("配置已保存；当前平台尚未接入实时数据适配器。");}catch(err){setNotice(errorMessage(err));}finally{setSaving(false);}};
  return <div className="workbench-smart-manager"><div className="workbench-manager-head"><h3>管理关注账户</h3><button type="button" className="terminal-icon-button" onClick={onClose} aria-label="关闭账户管理"><X size={16}/></button></div><div className="workbench-smart-callout"><Headphones size={16}/><span>只接入公开或已授权记录，不请求交易权限。暂未接入时不会生成模拟交易。</span></div><form onSubmit={add} className="workbench-manager-form"><div className="workbench-form-grid"><label>平台<select value={platform} onChange={e=>setPlatform(e.target.value as FollowAccount["platform"])}><option value="hyperliquid">Hyperliquid {!capabilities.hyperliquid?"· 待接入":""}</option><option value="binance">Binance {!capabilities.binance?"· 待接入":""}</option></select></label><label>名称 / 备注<input value={name} onChange={e=>setName(e.target.value)} placeholder="例如：某交易员"/></label></div><label>公开账户地址或标识<input value={address} onChange={e=>setAddress(e.target.value)} placeholder="不会请求交易权限"/></label><button className="workbench-primary" type="submit" disabled={saving}><Plus size={14}/>保存关注对象</button>{notice&&<p className="workbench-manager-notice">{notice}</p>}</form>{config.wallets.map(wallet=><div className="workbench-config-row" key={wallet.id}><div><b>{wallet.name}</b><small>{wallet.platform} · {wallet.address}</small></div><button type="button" onClick={()=>void onSave({...config,wallets:config.wallets.filter(item=>item.id!==wallet.id)})} aria-label={`删除${wallet.name}`}><X size={13}/></button></div>)}</div>;
}

export default function TerminalWorkspace() {
  const [session,setSession]=useState<Session|null>(null); const [config,setConfig]=useState(initialConfig); const [capabilities,setCapabilities]=useState<Capabilities>(defaultCapabilities); const [configLoading,setConfigLoading]=useState(true); const [configError,setConfigError]=useState("");
  const [theme,setTheme]=useState<SiteTheme>("soft");
  const [market,setMarket]=useState<FeedResponse|null>(null); const [selected,setSelected]=useState<FeedResponse|null>(null); const [smart,setSmart]=useState<(FeedResponse&{accounts:FollowAccount[]})|null>(null); const [feedLoading,setFeedLoading]=useState<Record<Panel,boolean>>({market:true,selected:true,smart:true}); const [feedErrors,setFeedErrors]=useState<Record<Panel,string>>({market:"",selected:"",smart:""}); const [pageLoading,setPageLoading]=useState<Record<Panel,boolean>>({market:false,selected:false,smart:false});
  const [activeView,setActiveView]=useState<View>("market"); const [marketSearch,setMarketSearch]=useState(""); const [selectedSearch,setSelectedSearch]=useState(""); const [marketFilter,setMarketFilter]=useState("全部"); const [selectedFilter,setSelectedFilter]=useState("全部"); const [marketSource,setMarketSource]=useState(""); const [selectedSource,setSelectedSource]=useState(""); const [paused,setPaused]=useState<Record<Panel,boolean>>({market:false,selected:false,smart:false}); const [newCounts,setNewCounts]=useState<Record<Panel,number>>({market:0,selected:0,smart:0});
  const [manager,setManager]=useState<"sources"|"smart"|null>(null); const [audioActive,setAudioActive]=useState(false); const [volumeDraft,setVolumeDraft]=useState(config.preferences.volume); const [split,setSplit]=useState(config.preferences.splitRatio); const [panelSizes,setPanelSizes]=useState(config.preferences.panelSizes); const [chartStatus,setChartStatus]=useState<TerminalChartStatus>("loading");
  const previousIds=useRef<Record<Panel,Set<string>>>({market:new Set(),selected:new Set(),smart:new Set()}); const lastSuccess=useRef<Record<Panel,number|undefined>>({market:undefined,selected:undefined,smart:undefined}); const initialized=useRef<Record<Panel,boolean>>({market:false,selected:false,smart:false}); const latestFeeds=useRef<Record<Panel,FeedResponse|null>>({market:null,selected:null,smart:null}); const scrollElements=useRef<Record<Panel,HTMLDivElement|null>>({market:null,selected:null,smart:null}); const lastBeepAt=useRef(0); const scrollAtLatest=useRef<Record<Panel,boolean>>({market:true,selected:true,smart:true}); const splitRef=useRef(split); const panelSizesRef=useRef(panelSizes); const audioContext=useRef<AudioContext|null>(null);

  useEffect(()=>setTheme(readSiteTheme()),[]);
  const toggleTheme=()=>{const next:SiteTheme=theme==='soft'?'dark':'soft';setTheme(next);writeSiteTheme(next)};

  const refreshConfig=useCallback(async()=>{setConfigLoading(true);try{const current=await request<ConfigResponse>("/api/terminal/config");setConfigError("");setConfig(current.config);setCapabilities(current.capabilities);setVolumeDraft(current.config.preferences.volume);setSplit(current.config.preferences.splitRatio);setPanelSizes(current.config.preferences.panelSizes);}catch(e){const err=e as Err;if(err.status!==401)setConfigError(errorMessage(e));}finally{setConfigLoading(false);}},[]);
  useEffect(()=>{
    let active=true;
    void request<Session>("/api/session").then(current=>{
      if(!active)return;
      setSession(current);
      if(current.signedIn)void refreshConfig();
      else setConfigLoading(false);
    }).catch(()=>{
      if(!active)return;
      setSession({signedIn:false});
      setConfigLoading(false);
    });
    return()=>{active=false;};
  },[refreshConfig]);
  const playTone=useCallback((panel:Panel,force=false)=>{if(volumeDraft<=0||(!force&&(!audioActive||!config.preferences.sound||!config.preferences.panelSound[panel])))return;try{const A=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!A)return;const ctx=audioContext.current||new A();audioContext.current=ctx;void ctx.resume();const o=ctx.createOscillator();const g=ctx.createGain();o.frequency.value=panel==="smart"?740:620;g.gain.setValueAtTime(.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(Math.max(.015,volumeDraft*.06),ctx.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.18);o.connect(g).connect(ctx.destination);o.start();o.stop(ctx.currentTime+.2);}catch{/* user gesture required */}},[audioActive,config.preferences,volumeDraft]);
  const setPanelError=(panel:Panel,message:string)=>setFeedErrors(current=>({...current,[panel]:message}));
  // Polling reads current UI preferences through a ref. Feed updates must not
  // recreate the timer or trigger another request as a render side effect.
  const live=useRef({session,config,paused,playTone,marketSearch,marketFilter,marketSource,selectedSearch,selectedFilter,selectedSource});
  live.current={session,config,paused,playTone,marketSearch,marketFilter,marketSource,selectedSearch,selectedFilter,selectedSource};
  const pendingRequests=useRef<Record<Panel,AbortController|null>>({market:null,selected:null,smart:null});
  const displayedFeeds=useRef<Record<Panel,FeedResponse|null>>({market:null,selected:null,smart:null});
  const displayedQueries=useRef<Record<Panel,string>>({market:"",selected:"",smart:""});
  const renderFeed=useCallback((panel:Panel,data:FeedResponse)=>{
    displayedFeeds.current[panel]=data;
    if(panel==="market")setMarket(data);
    else if(panel==="selected")setSelected(data);
    else setSmart({...data,accounts:[]});
  },[]);
  const loadPanel=useCallback(async(panel:Panel,reason:RefreshReason="manual")=>{
    const current=live.current;
    if(panel!=="market"&&!current.session?.signedIn)return;
    const filters=panel==="market"?{q:current.marketSearch,market:current.marketFilter,source:current.marketSource}:{q:current.selectedSearch,market:current.selectedFilter,source:current.selectedSource};
    const queryKey=JSON.stringify([filters,panel==="selected"?current.config.sources:panel==="smart"?current.config.wallets:null]);
    const pageBase=displayedFeeds.current[panel];
    const cursor=reason==="page"?pageBase?.nextCursor:undefined;
    if(reason==="page"&&(!cursor||(pageBase?.items.length||0)>=300||displayedQueries.current[panel]!==queryKey))return;
    if(pendingRequests.current[panel]) {
      if(reason!=="initial")return;
      pendingRequests.current[panel]?.abort();
    }
    const controller=new AbortController();
    pendingRequests.current[panel]=controller;
    if(reason==="initial") {
      previousIds.current[panel]=new Set();lastSuccess.current[panel]=undefined;
      initialized.current[panel]=false;latestFeeds.current[panel]=null;
      setNewCounts(value=>({...value,[panel]:0}));
      if(displayedFeeds.current[panel])renderFeed(panel,{...displayedFeeds.current[panel]!,nextCursor:null});
    }
    setPageLoading(value=>({...value,[panel]:reason==="page"}));
    setFeedLoading(value=>({...value,[panel]:true}));
    setFeedErrors(value=>({...value,[panel]:""}));
    const endpoint=panel==="market"?"news":panel==="selected"?"selected":"smart-money";
    try {
      const response=await request<FeedResponse>(`/api/terminal/${endpoint}${panel==="smart"?"":queryString({...filters,market:filters.market==="全部"?undefined:filters.market,cursor:cursor||undefined,limit:100})}`,{signal:controller.signal});
      if(pendingRequests.current[panel]!==controller)return;
      if(!response.items.length&&response.sources.some(source=>source.status==="error")&&!response.sources.some(source=>source.status==="ok"))throw new Error("消息源暂时不可用，已保留现有消息。请稍后重试。");
      const now=Date.now();
      const items=mergeEvents([],response.items,300) as TerminalEvent[];
      if(reason==="page"&&pageBase) {
        // Append only to the displayed snapshot: queued live events must not
        // move the reader while they are paging through history.
        const combined=mergeEvents(pageBase.items,items,300) as TerminalEvent[];
        const nextCursor=combined.length>=300||response.nextCursor===cursor?null:response.nextCursor;
        const paged={...pageBase,items:combined,nextCursor};
        const buffered=latestFeeds.current[panel]||pageBase;
        latestFeeds.current[panel]={...buffered,items:mergeEvents(buffered.items,items,300) as TerminalEvent[],nextCursor};
        previousIds.current[panel]=new Set([...previousIds.current[panel],...items.map(item=>item.id)].slice(-2000));
        renderFeed(panel,paged);
        return;
      }
      const fresh=freshEvents(previousIds.current[panel],items,{reason,lastSuccess:lastSuccess.current[panel],now}) as TerminalEvent[];
      const unseen=items.filter(item=>!previousIds.current[panel].has(item.id));
      const seen=new Set([...previousIds.current[panel],...items.map(item=>item.id)]);
      previousIds.current[panel]=new Set([...seen].slice(-2000));
      // Any failed source response resets the sound baseline: recovery is quiet.
      lastSuccess.current[panel]=response.sources.some(source=>source.status==="error")?undefined:now;
      const first=!initialized.current[panel];initialized.current[panel]=true;
      const prior=latestFeeds.current[panel];
      const data={...response,nextCursor:reason==="initial"||!prior?response.nextCursor:prior.nextCursor,items:mergeEvents(reason==="initial"?[]:prior?.items||[],items,300) as TerminalEvent[]};
      if(data.items.length>=300)data.nextCursor=null;
      latestFeeds.current[panel]=data;
      displayedQueries.current[panel]=queryKey;
      const state=live.current;
      const held=state.paused[panel]||!scrollAtLatest.current[panel];
      if(!held||first||reason==="initial") {
        renderFeed(panel,data);
        setNewCounts(value=>({...value,[panel]:0}));
      } else if(unseen.length) setNewCounts(value=>({...value,[panel]:Math.min(300,value[panel]+unseen.length)}));
      const sources=state.config.sources.map(source=>({...source,keywords:Array.isArray(source.keywords)?source.keywords.join(","):source.keywords||""}));
      const shouldNotify=fresh.some(item=>matchesReminder(item,panel,sources));
      if(shouldNotify&&state.config.preferences.sound&&state.config.preferences.panelSound[panel]&&now-lastBeepAt.current>=3500) {
        lastBeepAt.current=now;state.playTone(panel);
      }
    } catch(error) {
      if(pendingRequests.current[panel]!==controller||controller.signal.aborted)return;
      if(reason!=="page")lastSuccess.current[panel]=undefined;
      setFeedErrors(value=>({...value,[panel]:errorMessage(error)}));
    } finally {
      if(pendingRequests.current[panel]===controller){pendingRequests.current[panel]=null;setFeedLoading(value=>({...value,[panel]:false}));setPageLoading(value=>({...value,[panel]:false}));}
    }
  },[renderFeed]);
  const sourceConfigKey=JSON.stringify(config.sources);
  const walletConfigKey=JSON.stringify(config.wallets);
  useEffect(()=>{
    if(configLoading)return;
    const timer=window.setTimeout(()=>void loadPanel("market","initial"),250);
    return()=>{window.clearTimeout(timer);pendingRequests.current.market?.abort();pendingRequests.current.market=null;};
  },[configLoading,marketSearch,marketFilter,marketSource,loadPanel]);
  useEffect(()=>{
    if(configLoading||session===null)return;
    if(!session.signedIn){setSelected(null);latestFeeds.current.selected=null;setNewCounts(value=>({...value,selected:0}));setFeedErrors(value=>({...value,selected:""}));setFeedLoading(value=>({...value,selected:false}));return;}
    const timer=window.setTimeout(()=>void loadPanel("selected","initial"),250);
    return()=>{window.clearTimeout(timer);pendingRequests.current.selected?.abort();pendingRequests.current.selected=null;};
  },[configLoading,session?.signedIn,selectedSearch,selectedFilter,selectedSource,sourceConfigKey,loadPanel]);
  useEffect(()=>{
    if(configLoading||session===null)return;
    if(!session.signedIn){setSmart(null);latestFeeds.current.smart=null;setNewCounts(value=>({...value,smart:0}));setFeedErrors(value=>({...value,smart:""}));setFeedLoading(value=>({...value,smart:false}));return;}
    void loadPanel("smart","initial");
    return()=>{pendingRequests.current.smart?.abort();pendingRequests.current.smart=null;};
  },[configLoading,session?.signedIn,walletConfigKey,loadPanel]);
  useEffect(()=>{
    if(configLoading)return;
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")for(const panel of ["market","selected","smart"] as Panel[])void loadPanel(panel,"poll");},60000);
    return()=>window.clearInterval(timer);
  },[configLoading,loadPanel]);
  const fetchMarket=(reason:RefreshReason="manual")=>loadPanel("market",reason);
  const fetchSelected=(reason:RefreshReason="manual")=>loadPanel("selected",reason);
  const fetchSmart=()=>loadPanel("smart","manual");
  useEffect(()=>{splitRef.current=split;panelSizesRef.current=panelSizes;},[split,panelSizes]);
  useEffect(()=>()=>{audioContext.current?.close().catch(()=>{});},[]);
  const updateConfig=useCallback(async(next:ConfigResponse["config"])=>{if(!session?.signedIn)throw new Error("请先登录后保存个人监听配置。");const result=await request<ConfigResponse>("/api/terminal/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)});setConfig(result.config);setCapabilities(result.capabilities);setVolumeDraft(result.config.preferences.volume);setSplit(result.config.preferences.splitRatio);setPanelSizes(result.config.preferences.panelSizes);},[session?.signedIn]);
  const toggleAudio=()=>{if(audioActive){void updateConfig({...config,preferences:{...config.preferences,sound:false}}).catch(()=>{});setAudioActive(false);}};
  const enableAudio=async()=>{try{const A=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(A){const ctx=audioContext.current||new A();audioContext.current=ctx;await ctx.resume();}setAudioActive(true);const next={...config,preferences:{...config.preferences,sound:true}};if(session?.signedIn)await updateConfig(next);else setConfig(next);playTone("market",true);}catch(e){setPanelError("market",errorMessage(e));}};
  const testAudio=async()=>{if(!audioActive||!config.preferences.sound){await enableAudio();return;}playTone("market",true);};
  const persistVolume=async(value:number)=>{const next={...config,preferences:{...config.preferences,volume:value}};setConfig(next);if(session?.signedIn)await updateConfig(next).catch(e=>setPanelError("market",errorMessage(e)));};
  const resetLayout=async()=>{const panelDefaults={market:1/3,selected:1/3,smart:1/3};const next={...config,preferences:{...config.preferences,splitRatio:.38,panelSizes:panelDefaults}};setSplit(.38);setPanelSizes(panelDefaults);if(session?.signedIn)await updateConfig(next).catch(e=>setPanelError("market",errorMessage(e)));};
  const startSplit=(event:React.PointerEvent<HTMLDivElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);const move=(e:PointerEvent)=>{const width=window.innerWidth;const next=Math.min(.55,Math.max(.28,(e.clientX/width)));setSplit(next);};const stop=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);void updateConfig({...config,preferences:{...config.preferences,splitRatio:splitRef.current}}).catch(()=>{});};window.addEventListener("pointermove",move);window.addEventListener("pointerup",stop,{once:true});};
  const startPanelDrag=(index:0|1,event:React.PointerEvent<HTMLDivElement>)=>{const area=event.currentTarget.parentElement;if(!area)return;event.currentTarget.setPointerCapture(event.pointerId);const startY=event.clientY;const start={...panelSizesRef.current};const pairTotal=index===0?start.market+start.selected:start.selected+start.smart;const move=(e:PointerEvent)=>{const delta=(e.clientY-startY)/Math.max(1,area.clientHeight);const next={...start};const key=index===0?"market":"selected";const other=index===0?"selected":"smart";const value=Math.min(pairTotal-.2,Math.max(.2,start[key]+delta));next[key]=value;next[other]=pairTotal-value;setPanelSizes(next);};const stop=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);void updateConfig({...config,preferences:{...config.preferences,panelSizes:panelSizesRef.current}}).catch(()=>{});};window.addEventListener("pointermove",move);window.addEventListener("pointerup",stop,{once:true});};
  const togglePanelSound=(panel:Panel)=>{const next={...config,preferences:{...config.preferences,panelSound:{...config.preferences.panelSound,[panel]:!config.preferences.panelSound[panel]}}};setConfig(next);if(session?.signedIn)void updateConfig(next).catch(e=>setPanelError(panel,errorMessage(e)));};
  const markLatest=(panel:Panel)=>{setNewCounts(c=>({...c,[panel]:0}));scrollAtLatest.current[panel]=true;setPaused(p=>({...p,[panel]:false}));const latest=latestFeeds.current[panel];if(latest)renderFeed(panel,latest);window.requestAnimationFrame(()=>{document.querySelectorAll<HTMLDivElement>(`.terminal-page .workbench-window-${panel} .workbench-feed-scroll`).forEach(element=>element.scrollTo({top:0,behavior:"auto"}));});if(panel==="market")void fetchMarket("manual");else if(panel==="selected")void fetchSelected("manual");};
  const visibleSmart:FeedResponse|null=smart;
  const setPanelPause=(panel:Panel)=>{if(paused[panel])markLatest(panel);else setPaused(p=>({...p,[panel]:true}));};
  const feedFor=(panel:Panel)=>panel==="market"?market:panel==="selected"?selected:visibleSmart;
  const onChartStatus=(status:TerminalChartStatus)=>setChartStatus(status);
  const status=feedErrors.market?"error":sourceStatus(market?.sources);
  const onScroll=(panel:Panel,e:React.UIEvent<HTMLDivElement>)=>{const el=e.currentTarget;scrollElements.current[panel]=el;scrollAtLatest.current[panel]=el.scrollTop<=24;};
  const feedPanel=(panel:Panel,title:string,sessionRequired=false)=><FeedWindow title={title} panel={panel} feed={feedFor(panel)} loading={feedLoading[panel]} error={feedErrors[panel]} paused={paused[panel]} onPause={()=>setPanelPause(panel)} newCount={newCounts[panel]} onLatest={()=>markLatest(panel)} onRefresh={()=>panel==="market"?void fetchMarket("manual"):panel==="selected"?void fetchSelected("manual"):void fetchSmart()} onManage={panel==="selected"?()=>setManager(v=>v==="sources"?null:"sources"):panel==="smart"?()=>setManager(v=>v==="smart"?null:"smart"):undefined} showManage={manager===(panel==="selected"?"sources":"smart")} sessionRequired={sessionRequired&&session!==null&&!session.signedIn} onScroll={(event)=>onScroll(panel,event)} scrollRef={node=>{if(node&&node.offsetParent!==null)scrollElements.current[panel]=node}} onLoadMore={()=>void loadPanel(panel,"page")} pageLoading={pageLoading[panel]} soundEnabled={config.preferences.panelSound[panel]} onSoundToggle={()=>togglePanelSound(panel)} filters={panel==="market"?{search:marketSearch,market:marketFilter,source:marketSource,onSearch:setMarketSearch,onMarket:setMarketFilter,onSource:setMarketSource}:panel==="selected"?{search:selectedSearch,market:selectedFilter,source:selectedSource,onSearch:setSelectedSearch,onMarket:setSelectedFilter,onSource:setSelectedSource}:undefined}/>;

  return <div className={`terminal-page terminal-page--${theme}`} style={{"--terminal-split":`${split*100}%`} as React.CSSProperties}>
    <header className="terminal-topbar"><div className="terminal-brand"><Link href="/" className="terminal-back"><ArrowLeft size={15}/>返回主站</Link><span className="terminal-brand-divider"/><div><strong>交易终端</strong><small>RESEARCH WORKBENCH</small></div></div><div className="terminal-topbar-actions"><span className="terminal-connection"><i aria-hidden="true" className={`terminal-connection-dot terminal-connection-${status}`}/>{connectionText(status)}<span className="terminal-connection-detail">· 仅代表消息接口</span></span><button type="button" className="terminal-top-button terminal-theme-button" aria-pressed={theme==='dark'} onClick={toggleTheme} title="切换界面风格">{theme==='soft'?"☾":"☼"}<span>{theme==='soft'?"暗色风格":"柔和亮面"}</span></button><button type="button" className={`terminal-top-button ${audioActive&&config.preferences.sound?"is-on":""}`} onClick={audioActive?toggleAudio:enableAudio} title={audioActive?"关闭提示音":"点击激活提示音"}>{audioActive&&config.preferences.sound?<Volume2 size={15}/>:<VolumeX size={15}/>}<span>{audioActive&&config.preferences.sound?"提示音已开":"提示音"}</span></button><label className="terminal-volume-control" title="调整提示音音量"><Volume2 size={13}/><input type="range" min="0" max="1" step="0.05" value={volumeDraft} onChange={event=>{const value=Number(event.target.value);setVolumeDraft(value);setConfig(current=>({...current,preferences:{...current.preferences,volume:value}}));}} onBlur={event=>void persistVolume(Number(event.currentTarget.value))} aria-label="提示音音量"/><span>{Math.round(volumeDraft*100)}%</span></label><button type="button" className="terminal-top-button terminal-audio-test" onClick={()=>void testAudio()} title="试听提示音"><Headphones size={14}/><span>试听</span></button><button type="button" className="terminal-top-button" onClick={()=>setManager(manager?null:"sources")}><Settings2 size={15}/><span>设置</span></button></div></header>
    <div className="terminal-mobile-tabs" role="tablist" aria-label="终端视图"><button className={activeView==="chart"?"active":""} onClick={()=>setActiveView("chart")} role="tab">图表</button><button className={activeView==="market"?"active":""} onClick={()=>setActiveView("market")} role="tab">全市场</button><button className={activeView==="selected"?"active":""} onClick={()=>setActiveView("selected")} role="tab">自选</button><button className={activeView==="smart"?"active":""} onClick={()=>setActiveView("smart")} role="tab">聪明钱</button></div>
    <main className="terminal-main" aria-label="行情研究终端"><aside className={`terminal-monitor-area ${activeView!=="market"&&activeView!=="selected"&&activeView!=="smart"?"mobile-hidden":""}`}>
      <div className="terminal-desktop-panels" style={{gridTemplateRows:`minmax(160px,${panelSizes.market}fr) 8px minmax(160px,${panelSizes.selected}fr) 8px minmax(160px,${panelSizes.smart}fr)`}}>{feedPanel("market","全市场消息")}<div className="terminal-panel-divider" role="separator" aria-label="拖动调整全市场消息与自选消息高度" tabIndex={0} onPointerDown={event=>startPanelDrag(0,event)}><GripVertical size={12}/></div>{feedPanel("selected","自选消息",true)}<div className="terminal-panel-divider" role="separator" aria-label="拖动调整自选消息与聪明钱动态高度" tabIndex={0} onPointerDown={event=>startPanelDrag(1,event)}><GripVertical size={12}/></div>{feedPanel("smart","聪明钱动态",true)}</div>
      <div className="terminal-mobile-panels">{activeView==="market"&&feedPanel("market","全市场消息")}{activeView==="selected"&&feedPanel("selected","自选消息",true)}{activeView==="smart"&&feedPanel("smart","聪明钱动态",true)}</div>
      {manager==="sources"&&<SourceManager config={config} capabilities={capabilities} onSave={updateConfig} onClose={()=>setManager(null)}/>}
      {manager==="smart"&&<SmartManager config={config} capabilities={capabilities} onSave={updateConfig} onClose={()=>setManager(null)}/>}
      <div className="terminal-monitor-footer"><span>{session?.signedIn?`当前账号：${session.nickname||"已登录"}`:"访客模式：全市场消息可读"}</span><button type="button" onClick={()=>void refreshConfig()}><RefreshCw size={12}/>更新配置</button></div>
    </aside><div className="terminal-divider" role="separator" aria-label="拖动调整左右比例" tabIndex={0} onPointerDown={startSplit}><GripVertical size={14}/></div><section className={`terminal-chart-area ${activeView!=="chart"?"mobile-hidden":""}`} aria-label="TradingView K线图"><div className="terminal-chart-header"><div><span className="terminal-chart-kicker">MARKET CHART</span><strong>TradingView 高级图表</strong><span className="terminal-chart-state">{chartStatus==="ready"?"图表已加载":"图表加载中"}</span></div><button type="button" className="terminal-reset-button" onClick={()=>void resetLayout()}><RotateCcw size={13}/>恢复默认布局</button></div><div className="terminal-chart-host"><TerminalChart symbol="BINANCE:BTCUSDT" interval="60" theme={theme==='soft'?"light":"dark"} onStatusChange={onChartStatus}/></div><div className="terminal-chart-note">图表由 TradingView 官方组件提供。品种搜索、周期、指标和绘图工具在图表内使用；图表只用于研究，不提供下单或自动交易。</div></section></main>
    {configError&&<div className="terminal-toast" role="status">{configError}</div>}
  </div>;
}
