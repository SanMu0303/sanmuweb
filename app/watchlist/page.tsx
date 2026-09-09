"use client";
import Watchlist from '@/components/Watchlist';
import ResourceState from '@/components/ResourceState';
import {useResource} from '@/lib/live';
import type {WatchItem} from '@/lib/types';
export default function Page(){const r=useResource<WatchItem[]>('/api/watchlist');return <><div className="page-heading"><div><div className="eyebrow">THE WATCHLIST</div><h1>趋势观察池</h1><p>关注依据，跟踪阶段，也保留判断失效的理由。</p></div></div>{r.data&&!r.error?<Watchlist items={r.data}/>:<ResourceState error={r.error} retry={r.retry}/>}</>}
