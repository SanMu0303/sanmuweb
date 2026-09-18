"use client";

import ImageUploader from './ImageUploader';
import {useImageUploads} from '@/lib/useImageUploads';
import BoldTextarea from './BoldTextarea';
import {useRef, useState} from 'react';
import {request, useResource} from '@/lib/live';
import {MARKETS, TREND_STAGES} from '@/lib/posts';

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
 const uploads=useImageUploads();
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [slug,setSlug]=useState(()=> 'note-'+Date.now().toString(36));

 function openComposer(){
  setError('');
  setNotice('');
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
  if(busy)return;
  setNotice('');
  setError('');
  if(!text.trim()){setError('请先填写正文。');return}
  if(uploads.blocked){setError(uploads.uploading?'图片上传中，请等待完成。':'请重试或删除失败的图片后再发布。');return}
  setBusy(true);
  try{
   const now=new Date();
   const date=now.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
   await request('/api/admin/articles',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    slug,
    title:text.trim().replaceAll('**','').split('\n')[0].slice(0,100),
    excerpt:text.trim().slice(0,600),
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
    images:uploads.images.map(image=>({...image,isPreview:!member})),
    publishedAt:date,
    publishedAtTime:now.toISOString(),
    pinned:false,
    access:member?'member':'public',
    readMinutes:1,
    status:'published',
    revision:0,
    isExample:false,
   })});
   setText('');
   uploads.reset();
   setSymbol('');
   setTimeframe('');
   setTags('');
   setStage('');
   setMember(false);
   setSlug('note-'+Date.now().toString(36));
   dialog.current?.close();
   setOpen(false);
   setNotice('已发布，研究动态已更新。');
   onPublished?.();
  }catch(e){
   setError((e as Error).message);
  }finally{
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
     </div>
    </fieldset>
    {error&&<p role="alert" className="quick-composer-error">{error}</p>}
    <div className="quick-composer-actions">
     <p>可添加图片、标的和标签；发布后会同步到首页短文。</p>
     <div><button type="button" className="button secondary" onClick={closeComposer} disabled={busy}>取消</button><button className="button" type="submit" disabled={busy||uploads.uploading}>{busy?'发布中…':uploads.uploading?'图片上传中…':'发布'}</button></div>
    </div>
   </form>
  </dialog>
 </section>;
}
