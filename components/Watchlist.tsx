"use client";
import {useState} from 'react';
import Link from 'next/link';
import type {WatchItem} from '@/lib/types';

function date(value:string|undefined){if(!value)return '—';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value.slice(0,10):parsed.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});}

export default function Watchlist({items}:{items:WatchItem[]}){
 const [market,setMarket]=useState('全部'),[stage,setStage]=useState('全部');
 const shown=items.filter(w=>(market==='全部'||w.market===market)&&(stage==='全部'||w.stage===stage));
 const active=shown.filter(w=>w.observationStatus!=='ended'&&!w.endedAt),ended=shown.filter(w=>w.observationStatus==='ended'||!!w.endedAt);
 const cards=(group:WatchItem[])=><div className="watch-observation-grid">{group.map(w=><Link href={'/watchlist/'+encodeURIComponent(w.id||w.symbol)+'/'} className={'watch-observation-card '+(w.observationStatus==='ended'||w.endedAt?'is-ended':'')} key={w.id||w.symbol}>
   <div className="watch-observation-top"><span className="ticker">{w.symbol}</span></div>
   <h2>{w.name}</h2><p>{w.thesis}</p>
   <div className="watch-observation-times"><span>创建 {date(w.createdAt||w.updatedAt)}</span><span>{w.observationStatus==='ended'||w.endedAt?'结束':'最近更新'} {date(w.observationStatus==='ended'&&w.endedAt?w.endedAt:w.updatedAt)}</span><span className={'stage stage-'+w.stage}>{w.stage}</span></div>
   <span className="watch-observation-more">查看完整内容 ↗</span>
  </Link>)}</div>;
 return <>
  <div className="selects"><label>市场<select value={market} onChange={e=>setMarket(e.target.value)}>{['全部',...new Set(items.map(w=>w.market))].map(x=><option key={x}>{x}</option>)}</select></label><label>趋势阶段<select value={stage} onChange={e=>setStage(e.target.value)}>{['全部','准备','启动','运行','高潮','失效'].map(x=><option key={x}>{x}</option>)}</select></label></div>
  <p className="muted">{active.length} 项正在观察 · {ended.length} 项已结束 · 点击卡片查看完整记录</p>
  {!!active.length&&<section className="watchlist-group" aria-labelledby="active-watch-heading"><div className="section-line"><h2 id="active-watch-heading">正在观察 <span>{active.length}</span></h2><small>持续跟踪中的项目</small></div>{cards(active)}</section>}
  {!!ended.length&&<section className="watchlist-group watchlist-group-ended" aria-labelledby="ended-watch-heading"><div className="section-line"><h2 id="ended-watch-heading">结束观察 <span>{ended.length}</span></h2><small>历史记录仍可打开查看</small></div>{cards(ended)}</section>}
  {!shown.length&&<div className="empty"><h3>这个条件下还没有观察记录</h3><button className="button" onClick={()=>{setMarket('全部');setStage('全部')}}>查看全部观察</button></div>}
 </>;
}
