import type {Video} from './videos';
export const CONTENT_TYPES=['观察更新','交易计划','交易反馈','市场复盘','教学内容','video'] as const;
export const MARKETS=['美股','加密','A股','黄金','外汇','跨市场'] as const;
export const TREND_STAGES=['准备','启动','运行','高潮','失效'] as const;
export type ContentType=typeof CONTENT_TYPES[number];
export type TrendStage=typeof TREND_STAGES[number];
export interface PostImage {id?:string;thumbnailUrl?:string;storagePath?:string;width?:number;height?:number;mimeType?:string;fileSize?:number;sortOrder?:number;url:string;alt:string;caption?:string;isPreview:boolean}
export interface PostBlock {heading:string;text:string}
export interface Post {
  video?:Video;id:string;slug:string;title:string;summary:string;preview?:string;access?:'public'|'member'|'preview'|'member_required';content:PostBlock[];
  contentType:ContentType;format:'short'|'long';symbol:string;market:string;sector:string;
  trendStage:TrendStage|null;status:'draft'|'published';statusText:string;timeframe:string;
  tags:string[];images:PostImage[];isPinned:boolean;isMemberOnly:boolean;isPublic:boolean;
  publishedAt:string;updatedAt:string;author:{id:string;name:string};readTime:number;
  tradeId:string|null;watchlistId:string|null;relatedPosts:string[];isExample:boolean;
  locked:boolean;revision:number;
}
export type PostFilters={query:string;contentType:string;market:string;stage:string;symbol:string;tag:string;month:string};
export const EMPTY_FILTERS:PostFilters={query:'',contentType:'',market:'',stage:'',symbol:'',tag:'',month:''};
export function timelineHref(symbol:string,market:string){return '/symbol/?symbol='+encodeURIComponent(symbol)+'&market='+encodeURIComponent(market)}
export function filterHref(key:string,value:string){return '/?'+key+'='+encodeURIComponent(value)+'#research-stream'}
export {formatPostTime} from './postTime.mjs';
