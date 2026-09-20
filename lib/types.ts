import type {PostImage} from './posts';
export type Category='趋势观察'|'市场复盘'|'趋势课程'|'交易计划';
export interface Article{slug:string;title:string;excerpt:string;preview?:string;category:Category;tags:string[];publishedAt:string;pinned:boolean;access:'public'|'member'|'preview';readMinutes:number;sections:{heading:string;text:string}[]}
export type Stage='准备'|'启动'|'运行'|'高潮'|'失效';
export type ObservationStatus='active'|'ended';
export interface WatchItem{id?:string;revision?:number;isWeeklyFocus?:boolean;images?:PostImage[];symbol:string;name:string;market:string;stage:Stage;thesis:string;invalidation:string;publicSummary?:string;preview?:string;access?:'public'|'member'|'member_required';locked?:boolean;memberMessage?:string;maskedLines?:string[];memberPrompt?:{label:string;title:string;description:string;cta:string};createdAt?:string;updatedAt:string;articleSlug:string;/** The observation lifecycle is separate from the trend stage. */observationStatus?:ObservationStatus|string;endedAt?:string}
export function isWatchEnded(item:Pick<WatchItem,'observationStatus'|'endedAt'>|undefined){const state=String(item?.observationStatus||'').trim().toLowerCase();return !!item?.endedAt||['ended','已结束','结束观察','结束','已结束观察'].includes(state)}

// Additive editor fields: legacy article documents remain compatible.
export interface Article {id?:string;contentType?:import('./posts').ContentType;format?:'short'|'long';symbol?:string;market?:string;sector?:string;trendStage?:Stage|null;statusText?:string;timeframe?:string;updatedAt?:string;images?:import('./posts').PostImage[];author?:{id:string;name:string};isExample?:boolean;tradeId?:string|null;watchlistId?:string|null;relatedPosts?:string[]}
