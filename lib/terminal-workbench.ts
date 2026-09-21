export type Panel = 'market' | 'selected' | 'smart';
export type View = Panel | 'chart';
export type Connection = 'connecting' | 'ok' | 'error' | 'unconfigured' | 'disabled';
export type MonitorSource = {id:string; kind:'rss'|'x'|'wallet'; name:string; address:string; keywords:string; sound:boolean; enabled:boolean};
export type FollowAccount = {id:string; platform:'hyperliquid'|'binance'; name:string; address:string; enabled:boolean};
/**
 * Panel sizes are stored as relative weights (the three values normally sum to
 * one). Keeping them as weights lets the CSS grid keep a sensible minimum
 * height while still restoring the user's preferred split after a reload.
 */
export type Preferences = {splitRatio:number; volume:number; sound:boolean; panelSound:Record<Panel,boolean>; panelSizes:Record<Panel,number>};
export type WorkbenchConfig = {version:2; sources:MonitorSource[]; wallets:FollowAccount[]; preferences:Preferences};
export type Capabilities = {rss:boolean; x:boolean; wallet:boolean; hyperliquid:boolean; binance:boolean};
export type ConfigResponse = {config:WorkbenchConfig; capabilities:Capabilities; updatedAt?:string|null};
export type TerminalEvent = {id:string; sourceId:string; sourceName:string; publishedAt:string; title:string; summary:string; url:string; market:string; tags:string[]; account?:string; platform?:string; symbol?:string; direction?:string; action?:string; price?:number; quantity?:number};
export type SourceState = {id:string; name:string; status:Connection; message?:string; url?:string};
export type FeedResponse = {items:TerminalEvent[]; sources:SourceState[]; fetchedAt:string; nextCursor?:string|null; pollInterval?:number};
export const defaultPreferences:Preferences = {splitRatio:.38,volume:.35,sound:false,panelSound:{market:true,selected:true,smart:true},panelSizes:{market:1/3,selected:1/3,smart:1/3}};
export const defaultConfig:WorkbenchConfig = {version:2,sources:[],wallets:[],preferences:defaultPreferences};
export const defaultCapabilities:Capabilities = {rss:true,x:false,wallet:false,hyperliquid:false,binance:false};
export const panelTitles:Record<Panel,string> = {market:'全市场消息',selected:'自选消息',smart:'聪明钱动态'};
export const connectionLabels:Record<Connection,string> = {connecting:'连接中',ok:'已连接',error:'连接断开',unconfigured:'尚未配置',disabled:'已停用'};
export function dateLabel(value:string) { const date=new Date(value); return Number.isFinite(+date)?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date):'时间未知'; }
