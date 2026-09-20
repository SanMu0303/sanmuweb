"use client";

import ImageUploader from './ImageUploader';
import {useImageUploads} from '@/lib/useImageUploads';
import BoldTextarea from './BoldTextarea';
import {useRef, useState} from 'react';
import {request, useResource} from '@/lib/live';
import {MARKETS, TREND_STAGES} from '@/lib/posts';
import {isWatchEnded} from '@/lib/types';

/** Compact homepage entry point; the editor opens in a native modal dialog. */
export default function QuickComposer({onPublished}:{onPublished?:()=>void}){
 const session=useResource<{isAdmin:boolean}>('/api/session');
 const dialog=useRef<HTMLDialogElement>(null);
 const [open,setOpen]=useState(false);
 const [text,setText]=useState('');
 const [symbol,setSymbol]=useState('');
 const [timeframe,setTimeframe]=useState('');
 const [tags,setTags]=useState('');
 const [market,setMarket]=useState('跨市场');
 const [stage,setStage]=useState('');
 const [member,setMember]=useState(false);
 const [previewSummary,setPreviewSummary]=useState('');
 const [syncWatch,setSyncWatch]=useState(false);
 const [syncSummary,setSyncSummary]=useState('');
 const [weeklyFocus,setWeeklyFocus]=useState(false);
 const [syncInvalidation,setSyncInvalidation]=useState('');
 const uploads=useImageUploads();
 const [busy,setBusy]=useState(false);
 const submitting=useRef(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [slug,setSlug]=useState(()=> 'note-'+Date.now().toString(36));

 function openComposer(){
  setError('');
  setNotice('');
  setSyncWatch(false);
  setWeeklyFocus(false);
  setSyncInvalidation('');
  setSyncSummary('');
  setPreviewSummary('');
  setOpen(true);
  requestAnimationFrame(()=>dialog.current?.showModal());
 }

 function closeComposer(){
  if(busy)return;
  dialog.current?.close();
  setOpen(false);
 }

 async function publish(e:React.FormEvent){
  e.preventDefault();
  if(busy||submitting.current)return;
  setNotice('');
  setError('');
  if(!text.trim()){setError('请先填写正文。');return}
  if(uploads.blocked){setError(uploads.uploading?'图片上传中，请等待完成。':'请重试或删除失败的图片后再发布。');return}
  const normalizedSymbol=symbol.trim().toUpperCase();
  if(syncWatch&&(!normalizedSymbol||!stage)){setError('同步到观察池前，请填写标的并选择趋势阶段。');return}
  const firstSentence=text.trim().replaceAll('**','').split(/[。！？\n]/).map(part=>part.trim()).find(Boolean)||text.trim().replaceAll('**','');
  const restricted=member||syncWatch;
  const publicSummary=restricted?(previewSummary.trim()||syncSummary.trim()):firstSentence.slice(0,500);
  if(restricted&&!publicSummary){setError('会员短文或同步观察必须填写可公开展示的摘要，正文中的执行条件不会自动公开。');return}
  submitting.current=true;
  setBusy(true);
  try{
   const now=new Date();
   const date=now.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
   let watchRevision=0;let watchId:string|undefined;
   if(syncWatch){
    const records=await request<Array<{id?:string;symbol:string;revision?:number;deletedAt?:string;observationStatus?:string;endedAt?:string}>>('/api/admin/watchlist');
    const current=records.find(item=>item.symbol.trim().toUpperCase()===normalizedSymbol && !item.deletedAt && !isWatchEnded(item));
    watchRevision=current?.revision??0;watchId=current?(current.id||current.symbol):undefined;
   }
   await request('/api/admin/articles',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    slug,
    title:text.trim().replaceAll('**','').split('\n')[0].slice(0,100),
    excerpt:restricted?publicSummary:text.trim().slice(0,600),
    preview:restricted?publicSummary:'',
    sections:[{heading:'',text:text.trim()}],
    category:'趋势观察',
    contentType:'观察更新',
    format:'short',
    symbol:symbol.trim().toUpperCase(),
    market,
    sector:'',
    trendStage:stage||null,
    statusText:'',
    timeframe:timeframe.trim(),
    tags:tags.split(/[,，]/).map(t=>t.trim().replace(/^#/,'')).filter(Boolean),
    images:uploads.images.map(image=>({...image,isPreview:!restricted})),
    publishedAt:date,
    publishedAtTime:now.toISOString(),
    pinned:false,
    access:restricted?'member':'public',
    readMinutes:1,
    status:'published',
    revision:0,
    isExample:false,
    ...(syncWatch?{watchSync:{enabled:true,revision:watchRevision,...(watchId?{watchId}:{}),weeklyFocus,summary:publicSummary,invalidation:syncInvalidation.trim()}}:{}),
   })});
   setText('');
   uploads.reset();
   setSymbol('');
   setTimeframe('');
   setTags('');
   setStage('');
   setMember(false);
   setPreviewSummary('');
   setSyncWatch(false);
   setWeeklyFocus(false);
   setSyncInvalidation('');
   setSyncSummary('');
   setSlug('note-'+Date.now().toString(36));
   dialog.current?.close();
   setOpen(false);
   setNotice(syncWatch?'已发布短文，并同步到观察池。':'已发布，研究动态已更新。');
   onPublished?.();
  }catch(e){
   setError((e as Error).message);
  }finally{
   submitting.current=false;
   setBusy(false);
  }
 }

 if(!session.data?.isAdmin)return null;

 return <section className="quick-composer" aria-label="发布研究动态">
  <button className="composer-prompt" aria-expanded={open} onClick={openComposer} type="button">
   <span className="composer-avatar">木</span>
   <span>记录今天的观察……</span>
   <small>写一条</small>
  </button>
  {notice&&<p role="status">{notice}</p>}
  <dialog
   ref={dialog}
   className="quick-composer-dialog"
   aria-labelledby="quick-composer-title"
   onCancel={e=>{e.preventDefault();closeComposer()}}
   onClose={()=>setOpen(false)}
   onClick={e=>{if(e.target===e.currentTarget)closeComposer()}}
  >
   <form noValidate onSubmit={publish} className="quick-composer-form">
    <header className="quick-composer-header">
     <div><span className="eyebrow">SANMU / RESEARCH JOURNAL</span><h2 id="quick-composer-title">写一条研究动态</h2></div>
     <button className="quick-composer-close" type="button" onClick={closeComposer} aria-label="关闭编辑窗口">×</button>
    </header>
    <fieldset disabled={busy} className="composer-fieldset">
     <ImageUploader uploads={uploads} disabled={busy}>
      <BoldTextarea aria-label="观察正文" placeholder="记录结构的变化、等待的条件，或一次交易反馈……" value={text} maxLength={20000} onChange={e=>setText(e.target.value)} required/>
     </ImageUploader>
     <div className="composer-tools">
      <input aria-label="标的" placeholder="标的，如 BTC" value={symbol} maxLength={40} onChange={e=>setSymbol(e.target.value.toUpperCase())}/>
      <input aria-label="周期" placeholder="周期，如 1H" value={timeframe} maxLength={30} onChange={e=>setTimeframe(e.target.value)}/>
      <input aria-label="标签" placeholder="标签，逗号分隔" value={tags} maxLength={360} onChange={e=>setTags(e.target.value)}/>
      <select aria-label="发布市场" value={market} onChange={e=>setMarket(e.target.value)}>{MARKETS.map(m=><option key={m}>{m}</option>)}</select>
      <select aria-label="发布阶段" value={stage} onChange={e=>setStage(e.target.value)}><option value="">阶段：不适用</option>{TREND_STAGES.map(s=><option key={s}>{s}</option>)}</select>
      <label><input type="checkbox" checked={member} onChange={e=>setMember(e.target.checked)}/>会员可见</label>
      {member&&<label className="composer-member-summary">公开摘要（必填）<textarea rows={2} maxLength={600} value={previewSummary} onChange={e=>setPreviewSummary(e.target.value)} placeholder="填写允许未订阅用户看到的摘要，不要包含价格、入场条件或仓位建议。"/></label>}
     </div>
     <div className={'composer-sync-box'+(syncWatch?' selected':'')}>
      <label className="composer-sync-toggle"><input type="checkbox" checked={syncWatch} onChange={e=>setSyncWatch(e.target.checked)}/><span><strong>同步到观察池</strong><small>发布短文时，同时保存一条趋势观察记录并保留历史观点。</small></span></label>
      {syncWatch&&<div className="composer-sync-fields"><small>需要填写标的和趋势阶段；观察池只保存这条摘要，不会复制会员正文。</small><label>公开摘要<span aria-hidden="true">（必填）</span><textarea rows={2} maxLength={500} value={syncSummary} onChange={e=>setSyncSummary(e.target.value)} placeholder="填写允许公开展示的判断摘要，不要包含价格、入场条件或仓位建议。"/></label><label><input type="checkbox" checked={weeklyFocus} onChange={e=>setWeeklyFocus(e.target.checked)}/>列为本周重点（最多 3 个）</label><label>失效条件（可选）<textarea rows={2} maxLength={2000} value={syncInvalidation} onChange={e=>setSyncInvalidation(e.target.value)} placeholder="例如：跌破关键支撑后停止跟踪"/></label></div>}
     </div>
    </fieldset>
    {error&&<p role="alert" className="quick-composer-error">{error}</p>}
    <div className="quick-composer-actions">
     <p>{syncWatch?'发布后会同时写入首页短文和趋势观察池。':'可添加图片、标的和标签；发布后会显示在首页短文。'}</p>
     <div><button type="button" className="button secondary" onClick={closeComposer} disabled={busy}>取消</button><button className="button" type="submit" disabled={busy||uploads.uploading}>{busy?'发布中…':uploads.uploading?'图片上传中…':'发布'}</button></div>
    </div>
   </form>
  </dialog>
 </section>;
}
