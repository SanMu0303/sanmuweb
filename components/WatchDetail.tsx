"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {request,useResource} from '@/lib/live';
import {TREND_STAGES,type Post} from '@/lib/posts';
import type {WatchItem} from '@/lib/types';
import PostImages from './PostImages';
import BoldText from './BoldText';
import ImageUploader from './ImageUploader';
import {useImageUploads} from '@/lib/useImageUploads';

type HistoryEntry={document:WatchItem;revision:number;recorded_at:string};
type Detail={item:WatchItem;history:HistoryEntry[]};
function date(value:string|undefined){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value.slice(0,10):d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});}
function day(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});}
function slug(symbol:string){return 'watch-'+symbol.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+Date.now().toString(36);}

export default function WatchDetail({symbol}:{symbol:string}){
 const resource=useResource<Detail>('/api/watchlist/'+encodeURIComponent(symbol));
 const session=useResource<{isAdmin:boolean}>('/api/session');
 const router=useRouter();
 const dialog=useRef<HTMLDialogElement>(null);const [text,setText]=useState('');const [stage,setStage]=useState<WatchItem['stage']>('准备');const [sync,setSync]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [ending,setEnding]=useState(false);
 const uploads=useImageUploads();
 const detail=resource.data;
 useEffect(()=>{if(detail)setStage(detail.item.stage)},[detail?.item.stage]);
 function open(){if(!detail)return;setText('');setStage(detail.item.stage);setSync(true);setError('');setNotice('');uploads.reset();dialog.current?.showModal()}
 function close(){if(!busy)dialog.current?.close()}
 async function endObservation(){if(!detail||ending||busy||detail.item.observationStatus==='ended'||detail.item.endedAt)return;if(!window.confirm('结束这个观察周期？历史观点会保留，之后不会再接受同步更新。'))return;setEnding(true);setError('');setNotice('');try{await request<WatchItem>('/api/admin/watchlist',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'end',id:detail.item.id||detail.item.symbol,symbol:detail.item.symbol,revision:detail.item.revision??0})});router.push('/watchlist/');router.refresh()}catch(e){setError((e as Error).message);setEnding(false)}}
 async function publish(e:React.FormEvent){e.preventDefault();if(!detail||busy||!text.trim())return;if(uploads.blocked){setError(uploads.uploading?'图片上传中，请等待完成。':'请重试或删除上传失败的图片后再保存。');return}setBusy(true);setError('');setNotice('');const item=detail.item;try{
  if(sync){
   const hasImages=uploads.images.length>0;
   const saved=await request<Post&{watchSyncResult?:{revision?:number}}>('/api/admin/articles',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:slug(item.symbol),title:text.trim().split(/[。！？\n]/)[0].slice(0,100),excerpt:text.trim().slice(0,600),category:'趋势观察',contentType:'观察更新',format:'short',symbol:item.symbol,market:item.market,sector:'',trendStage:stage,statusText:'',timeframe:'',tags:[],images:[],publishedAt:day(),pinned:false,access:'public',readMinutes:1,sections:[{heading:'',text:text.trim()}],status:'published',revision:0,isExample:false,...(hasImages?{}:{watchSync:{enabled:true,watchId:item.id||item.symbol,revision:item.revision??0,summary:text.trim(),invalidation:''}})})});
   // The atomic article/watch sync cannot carry a second image set in the
   // current database function. When images are present, save the article
   // first and then save the observation once with the uploaded images so the
   // timeline gets one complete card rather than a duplicate revision.
   if(hasImages) await request<WatchItem>('/api/admin/watchlist',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,id:item.id||item.symbol,stage,thesis:text.trim(),updatedAt:day(),revision:item.revision??0,articleSlug:saved.slug,images:uploads.images})});
   setNotice('更新已发布，并同步为首页短文。');
  }else{
   await request<WatchItem>('/api/admin/watchlist',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,id:item.id||item.symbol,stage,thesis:text.trim(),updatedAt:day(),revision:item.revision??0,images:uploads.images})});
   setNotice('观察内容已更新。');
  }
  uploads.reset();dialog.current?.close();resource.retry();
 }catch(e){setError((e as Error).message)}finally{setBusy(false)} }
 if(resource.error)return <div className="empty" role="alert"><p>{resource.error}</p><button className="button" onClick={resource.retry}>重新读取</button></div>;
 if(!detail)return <div className="empty" role="status">正在读取观察记录…</div>;
 const {item,history}=detail;
 const ended=item.observationStatus==='ended'||!!item.endedAt;
 const records=[...history];
 if(!records.length||!records.some(h=>h.revision===item.revision))records.push({document:item,revision:item.revision??0,recorded_at:item.updatedAt});
 records.sort((a,b)=>a.revision-b.revision);
 const latestRevision=records.at(-1)?.revision;
 return <div className="watch-detail">
  <Link className="breadcrumb" href="/watchlist/">← 返回趋势观察池</Link>
  <header className="watch-detail-header"><div><div className="eyebrow">TREND OBSERVATION · {item.symbol}</div><h1>{item.name}</h1><p>{item.symbol} · {item.market}</p></div><div className="watch-detail-stage"><small>当前趋势阶段</small><span className={'stage stage-'+item.stage}>{item.stage}</span>{ended&&<span className="watch-lifecycle-ended">已结束</span>}</div></header>
  {notice&&<p className="notice" role="status">{notice}</p>}
  <section className="watch-detail-summary"><div className="risk">当前失效条件：{item.invalidation||'暂未设置'}</div><div className="watch-detail-meta"><span>创建时间：{date(item.createdAt||item.updatedAt)}</span><span>最近更新时间：{date(item.updatedAt)}</span>{item.articleSlug&&<Link href={'/article/?slug='+encodeURIComponent(item.articleSlug)}>查看关联短文 ↗</Link>}</div></section>
  {session.data?.isAdmin&&<div className="watch-detail-actions"><button className="button secondary" onClick={endObservation} disabled={ending||busy||ended}>{ending?'结束中…':ended?'已结束观察':'结束观察'}</button>{!ended&&<button className="button watch-update-trigger" onClick={open}>＋ 添加观点</button>}</div>}
  <section className="watch-map-section" aria-labelledby="watch-map-heading">
   <div className="section-line"><h2 id="watch-map-heading">观点脉络 <span>{records.length} 条</span></h2><small className="watch-map-hint">从最初观察到最新判断</small></div>
   <div className="watch-map-root"><span>{item.symbol}</span><strong>{item.name}</strong><small>观察起点 · {date(item.createdAt||records[0]?.recorded_at||item.updatedAt)}</small></div>
   <ol className="watch-history-list watch-map" aria-label="按时间连接的观察观点">
    {records.map((h,index)=><li className={'watch-map-node'+(h.revision===latestRevision?' is-latest':'')} key={h.revision}>
     <article className="watch-history-entry">
      <header><strong><span className="watch-map-index">{String(index+1).padStart(2,'0')}</span>{h.revision===latestRevision?'最新观点':index===0?'初始观点':'观点更新'}</strong><span className={'record-stage record-stage-'+h.document.stage}>{h.document.stage}</span></header>
      <time className="watch-map-date" dateTime={h.recorded_at}>{date(h.recorded_at)}</time>
      <p><BoldText text={h.document.thesis}/></p>
      {h.document.images?.length?<PostImages images={h.document.images}/>:null}
      {h.document.invalidation&&h.document.invalidation!=='暂未设置'&&<div className="watch-map-risk">失效条件：{h.document.invalidation}</div>}
      {h.document.articleSlug&&<Link href={'/article/?slug='+encodeURIComponent(h.document.articleSlug)}>查看对应短文 ↗</Link>}
     </article>
    </li>)}
   </ol>
  </section>
  <dialog ref={dialog} className="watch-update-dialog" onCancel={e=>{e.preventDefault();close()}}><form className="watch-update-form" onSubmit={publish}><h2>添加「{item.name}」观点</h2><p>这条观点会保留在标的详情时间线上。</p><label>观点内容<textarea required maxLength={2000} value={text} onChange={e=>setText(e.target.value)} placeholder="记录新的结构、条件和判断……"/></label><label>观点阶段<select value={stage} onChange={e=>setStage(e.target.value as WatchItem['stage'])}>{TREND_STAGES.map(s=><option key={s}>{s}</option>)}</select></label><div className="watch-update-images"><div className="section-line"><h3>观点配图</h3><span>可选，最多 9 张</span></div><ImageUploader uploads={uploads} disabled={busy}><p>上传图表或截图，保存后会显示在这条观点卡片中。</p></ImageUploader></div><label className="checkbox-label"><input type="checkbox" checked={sync} onChange={e=>setSync(e.target.checked)}/>同步到首页短文</label><small>同步后会发布一条公开短文，并同时更新趋势观察卡片的简介、阶段和最近更新时间。</small>{error&&<p className="notice error" role="alert">{error}</p>}<div className="actions"><button className="button" type="submit" disabled={busy||ended||!text.trim()||uploads.uploading}>{busy?'保存中…':sync?'发布并同步':'保存观点'}</button><button className="button secondary" type="button" onClick={close} disabled={busy}>取消</button></div></form></dialog>
 </div>;
}
