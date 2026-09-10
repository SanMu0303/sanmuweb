"use client";
import Feed from '@/components/Feed';
import {useResource} from '@/lib/live';
import type {Post} from '@/lib/posts';
import type {WatchItem} from '@/lib/types';
import ResourceState from '@/components/ResourceState';
export default function Home(){const posts=useResource<Post[]>('/api/feed');const watch=useResource<WatchItem[]>('/api/watchlist');if(!posts.data||!watch.data||posts.error||watch.error)return <ResourceState error={posts.error||watch.error} retry={()=>{posts.retry();watch.retry()}}/>;return <><div className="terminal-heading"><div><span className="eyebrow">SANMU / RESEARCH JOURNAL</span><h1>趋势研究日志</h1><p>观察、计划、执行与复盘。记录一个机会的完整过程。</p></div><span className="terminal-caption">独立研究 · 持续更新<small>研究示例 / 非实时行情</small></span></div><Feed articles={posts.data} home watchItems={watch.data}/></>}
