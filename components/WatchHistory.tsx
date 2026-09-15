"use client";
import {useState} from 'react';
import {useResource} from '@/lib/live';
import type {WatchItem} from '@/lib/types';
import PostImages from './PostImages';
function Records({symbol}:{symbol:string}){const r=useResource<{document:WatchItem;revision:number;recorded_at:string}[]>('/api/watchlist/'+encodeURIComponent(symbol)+'/history');return <div>{r.error?<p role="alert">{r.error}<button onClick={r.retry}>重试</button></p>:!r.data?<p>正在读取历史…</p>:r.data.map(x=><section key={x.revision} style={{padding:'14px 0',borderBottom:'1px solid #252827'}}><small>{new Date(x.recorded_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · {x.document.stage} · 版本 {x.revision}</small><p>{x.document.thesis}</p><p>失效条件：{x.document.invalidation}</p><PostImages images={x.document.images||[]}/>{x.document.articleSlug&&<a href={'/article/?slug='+encodeURIComponent(x.document.articleSlug)}>查看当次动态 ↗</a>}</section>)}</div>}
export default function WatchHistory({symbol}:{symbol:string}){const [open,setOpen]=useState(false);return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary style={{cursor:'pointer',padding:'12px 0'}}>历次观察记录</summary>{open&&<Records symbol={symbol}/>}</details>}
