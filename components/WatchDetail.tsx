"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {request,useResource} from '@/lib/live';
import {TREND_STAGES,type Post} from '@/lib/posts';
import type {WatchItem} from '@/lib/types';
import PostImages from './PostImages';

type HistoryEntry={document:WatchItem;revision:number;recorded_at:string};
type Detail={item:WatchItem;history:HistoryEntry[]};
function date(value:string|undefined){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value.slice(0,10):d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});}
function day(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});}
function slug(symbol:string){return 'watch-'+symbol.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+Date.now().toString(36);}

export default function WatchDetail({symbol}:{symbol:string}){
 const resource=useResource<Detail>('/api/watchlist/'+encodeURIComponent(symbol));
 const session=useResource<{isAdmin:boolean}>('/api/session');
 const dialog=useRef<HTMLDialogElement>(null);const [text,setText]=useState('');const [stage,setStage]=useState<WatchItem['stage']>('准备');const [sync,setSync]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const detail=resource.data;
 useEffect(()=>{if(detail)setStage(detail.item.stage)},[detail?.item.stage]);
 function open(){if(!detail)return;setText('');setStage(detail.item.stage);setSync(true);setError('');setNotice('');dialog.current?.showModal()}
 function close(){if(!busy)dialog.current?.close()}
 async function publish(e:React.FormEvent){e.preventDefault();if(!detail||busy||!text.trim())return;setBusy(true);setError('');setNotice('');const item=detail.item;try{
  if(sync){
   await request<Post>('/api/admin/articles',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:slug(item.symbol),title:text.trim().split(/[。！？\n]/)[0].slice(0,100),excerpt:text.trim().slice(0,600),category:'趋势观察',contentType:'观察更新',format:'short',symbol:item.symbol,market:item.market,sector:'',trendStage:stage,statusText:'',timeframe:'',tags:[],images:[],publishedAt:day(),pinned:false,access:'public',readMinutes:1,sections:[{heading:'',text:text.trim()}],status:'published',revision:0,isExample:false,watchSync:{enabled:true,revision:item.revision??0,summary:text.trim(),invalidation:''}})});
   setNotice('更新已发布，并同步为首页短文。');
  }else{
   await request<WatchItem>('/api/admin/watchlist',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,stage,thesis:text.trim(),updatedAt:day(),revision:item.revision??0})});
   setNotice('观察内容已更新。');
  }
  dialog.current?.close();resource.retry();
 }catch(e){setError((e as Error).message)}finally{setBusy(false)} }
 if(resource.error)return <div className="empty" role="alert"><p>{resource.error}</p><button className="button" onClick={resource.retry}>重新读取</button></div>;
 if(!detail)return <div className="empty" role="status">正在读取观察记录…</div>;
 const {item,history}=detail;
 return <div className="watch-detail">
  <Link className="breadcrumb" href="/watchlist/">← 返回趋势观察池</Link>
  <header className="watch-detail-header"><div><div className="eyebrow">TREND OBSERVATION · {item.symbol}</div><h1>{item.name}</h1><p>{item.symbol} · {item.market}</p></div><div className="watch-detail-stage"><small>当前趋势阶段</small><span className={'stage stage-'+item.stage}>{item.stage}</span></div></header>
  {notice&&<p className="notice" role="status">{notice}</p>}
  <section className="watch-detail-summary"><p>{item.thesis}</p><div className="risk">失效条件：{item.invalidation||'暂未设置'}</div><div className="watch-detail-meta"><span>创建时间：{date(item.createdAt||item.updatedAt)}</span><span>最近更新时间：{date(item.updatedAt)}</span>{item.articleSlug&&<Link href={'/article/?slug='+encodeURIComponent(item.articleSlug)}>查看关联短文 ↗</Link>}</div></section>
  {session.data?.isAdmin&&<button className="button watch-update-trigger" onClick={open}>＋ 添加更新内容</button>}
  <section><div className="section-line"><h2>完整更新记录 <span>{history.length} 条</span></h2></div><div className="watch-history-list">{history.map(h=><article className="watch-history-entry" key={h.revision}><header><strong>{date(h.recorded_at)}</strong><span>版本 {h.revision} · {h.document.stage}</span></header><p>{h.document.thesis}</p>{h.document.images?.length?<PostImages images={h.document.images}/>:null}{h.document.articleSlug&&<Link href={'/article/?slug='+encodeURIComponent(h.document.articleSlug)}>查看对应短文 ↗</Link>}</article>)}</div></section>
  <dialog ref={dialog} className="watch-update-dialog" onCancel={e=>{e.preventDefault();close()}}><form className="watch-update-form" onSubmit={publish}><h2>添加「{item.name}」更新</h2><p>这次更新会保留在标的详情时间线上。</p><label>更新内容<textarea required maxLength={20000} value={text} onChange={e=>setText(e.target.value)} placeholder="记录新的结构、条件和判断……"/></label><label>更新后的趋势阶段<select value={stage} onChange={e=>setStage(e.target.value as WatchItem['stage'])}>{TREND_STAGES.map(s=><option key={s}>{s}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={sync} onChange={e=>setSync(e.target.checked)}/>同步到首页短文</label><small>同步后会发布一条公开短文，并同时更新趋势观察卡片的简介、阶段和最近更新时间。</small>{error&&<p className="notice error" role="alert">{error}</p>}<div className="actions"><button className="button" type="submit" disabled={busy||!text.trim()}>{busy?'保存中…':sync?'发布并同步':'保存更新'}</button><button className="button secondary" type="button" onClick={close} disabled={busy}>取消</button></div></form></dialog>
 </div>;
}
