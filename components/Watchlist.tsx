"use client";
import {useState} from 'react';
import Link from 'next/link';
import type {WatchItem} from '@/lib/types';

function date(value:string|undefined){if(!value)return '—';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value.slice(0,10):parsed.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});}

export default function Watchlist({items}:{items:WatchItem[]}){
 const [market,setMarket]=useState('全部'),[stage,setStage]=useState('全部');
 const shown=items.filter(w=>(market==='全部'||w.market===market)&&(stage==='全部'||w.stage===stage));
 return <>
  <div className="selects"><label>市场<select value={market} onChange={e=>setMarket(e.target.value)}>{['全部',...new Set(items.map(w=>w.market))].map(x=><option key={x}>{x}</option>)}</select></label><label>趋势阶段<select value={stage} onChange={e=>setStage(e.target.value)}>{['全部','准备','启动','运行','高潮','失效'].map(x=><option key={x}>{x}</option>)}</select></label></div>
  <p className="muted">{shown.length} 项观察 · 点击卡片查看完整记录</p>
  <div className="watch-observation-grid">{shown.map(w=><Link href={'/watchlist/'+encodeURIComponent(w.symbol)+'/'} className="watch-observation-card" key={w.symbol}>
   <div className="watch-observation-top"><span className="ticker">{w.symbol}</span><span className={'stage stage-'+w.stage}>{w.stage}</span></div>
   <h2>{w.name}</h2><p>{w.thesis}</p>
   <div className="watch-observation-times"><span>创建 {date(w.createdAt||w.updatedAt)}</span><span>最近更新 {date(w.updatedAt)}</span></div>
   <span className="watch-observation-more">查看完整内容 ↗</span>
  </Link>)}</div>
  {!shown.length&&<div className="empty"><h3>这个条件下还没有观察记录</h3><button className="button" onClick={()=>{setMarket('全部');setStage('全部')}}>查看全部观察</button></div>}
 </>;
}
