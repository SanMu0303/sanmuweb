"use client";

import {useRef,useState} from 'react';
import {request} from '@/lib/live';
import {MARKETS,TREND_STAGES,type Post,type TrendStage} from '@/lib/posts';
import {isWatchEnded,type WatchItem} from '@/lib/types';

type Observation=WatchItem&{deletedAt?:string};
type Props={post:Post;onSaved?:()=>void};
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
function defaultThesis(post:Post){
 if(post.isMemberOnly)return '';
 return post.content.map(block=>block.text).join('\n').replaceAll('**','').trim().slice(0,2000);
}

export default function AddToWatchlist({post,onSaved}:Props){
 const dialog=useRef<HTMLDialogElement>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[ready,setReady]=useState(false);
 const [error,setError]=useState(''),[savedSymbol,setSavedSymbol]=useState('');
 const [items,setItems]=useState<Observation[]>([]);
 const [symbol,setSymbol]=useState(post.symbol),[name,setName]=useState(post.symbol),[market,setMarket]=useState(post.market);
 const [stage,setStage]=useState<TrendStage>(post.trendStage||'准备');
 const [thesis,setThesis]=useState(''),[invalidation,setInvalidation]=useState('');
 const normalizedSymbol=symbol.trim().toUpperCase();
 const matching=items.filter(item=>item.symbol.trim().toUpperCase()===normalizedSymbol);
 const existing=matching.find(item=>!isWatchEnded(item)&&!item.deletedAt);
 const historical=matching.find(item=>item.deletedAt||isWatchEnded(item));
 function selectSymbol(value:string,records=items){
  const next=value.toUpperCase();const item=records.find(row=>row.symbol.trim().toUpperCase()===next.trim()&&!row.deletedAt&&!isWatchEnded(row));
  setSymbol(next);setName(item?.name||next);setMarket(item?.market||post.market);
  setStage(post.trendStage||item?.stage||'准备');setInvalidation(item?.invalidation||'');
 }
 async function openEditor(){
  if(loading||busy)return;
  setError('');setSavedSymbol('');setReady(false);setLoading(true);setItems([]);
  selectSymbol(post.symbol,[]);setThesis(defaultThesis(post));dialog.current?.showModal();
  try{const records=await request<Observation[]>('/api/admin/watchlist');setItems(records);selectSymbol(post.symbol,records);setReady(true)}
  catch(e){setError((e as Error).message)}finally{setLoading(false)}
 }
 function close(){if(!busy&&!loading)dialog.current?.close()}
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy||!ready||savedSymbol)return;
  if(!/^[A-Z0-9.-]+$/.test(normalizedSymbol)){setError('请填写标的代码，例如 BTC、PONS1 或 NVDA。');return}

  if(!name.trim()||!thesis.trim()){setError('请填写标的名称和本次观点。');return}
  setBusy(true);setError('');
  try{
   const saved=await request<WatchItem>('/api/admin/watchlist',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    ...(existing?{...existing,id:existing.id||existing.symbol}:{}),symbol:existing?.symbol||normalizedSymbol,name:name.trim(),market,stage,thesis:thesis.trim(),
    invalidation:invalidation.trim()||existing?.invalidation||'暂未设置',updatedAt:today(),createdAt:existing?.createdAt||new Date().toISOString(),
    articleSlug:post.slug,revision:existing?.revision??0,isWeeklyFocus:existing?.isWeeklyFocus===true,images:existing?.images||[]
   })});
   setSavedSymbol(saved.id||saved.symbol);setItems(records=>[saved,...records.filter(row=>(row.id||row.symbol)!==(saved.id||saved.symbol))]);onSaved?.();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <>
  <button type="button" className="watchlist-entry-button" onClick={openEditor}>＋ 添加到观察池</button>
  <dialog ref={dialog} className="watchlist-entry-dialog" aria-label="添加到观察池" onCancel={e=>{e.preventDefault();close()}}>
   <form className="watchlist-entry-form" onSubmit={save}>
    <h2>{savedSymbol?'已保存到观察池':existing?'添加新的观察观点':'添加到观察池'}</h2>
    {savedSymbol?<><p role="status">本条短文已关联到观察池，观点和阶段已保存。</p><a className="button" href={'/watchlist/'+encodeURIComponent(savedSymbol)+'/'}>查看观察详情 ↗</a></>:<>
     <p className="watchlist-entry-caption">已有标的会增加一条观点记录，之前的观点仍保留。</p>
     {loading?<p role="status">正在读取观察记录…</p>:<fieldset disabled={busy||!ready}>
      <div className="watchlist-entry-row"><label>标的代码<input value={symbol} maxLength={40} onChange={e=>selectSymbol(e.target.value)} placeholder="例如 BTC / PONS1" required/></label><label>标的名称<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} required/></label></div>
      <div className="watchlist-entry-row"><label>市场<select value={market} disabled={!!existing} onChange={e=>setMarket(e.target.value)}>{[...new Set([...MARKETS,market])].map(value=><option key={value}>{value}</option>)}</select></label><label>趋势阶段<select value={stage} onChange={e=>setStage(e.target.value as TrendStage)}>{TREND_STAGES.map(value=><option key={value}>{value}</option>)}</select></label></div>
      <label>本次观点<textarea value={thesis} maxLength={2000} onChange={e=>setThesis(e.target.value)} placeholder="写下本次公开展示的观察观点" required/><small>{thesis.length} / 2000 字</small></label>
      <label>失效条件<textarea value={invalidation} maxLength={2000} onChange={e=>setInvalidation(e.target.value)} placeholder="可选，留空沿用已有条件"/></label>
      <small>{post.isMemberOnly?'原短文为会员内容，请单独填写可公开的观点；会员正文和图片不会复制。':'本次观点将在观察池公开展示，原短文保持不变。'}</small>
      {historical&&!existing&&<p className="notice">这是新的观察周期，历史记录会保留。</p>}
     </fieldset>}
    </>}
    {error&&<p className="notice error" role="alert">{error}</p>}
    <div className="actions">{!savedSymbol&&<button type="submit" className="button" disabled={busy||loading||!ready}>{busy?'保存中…':existing?'添加观点':'加入观察池'}</button>}<button type="button" className="button secondary" onClick={close} disabled={busy||loading}>关闭</button></div>
   </form>
  </dialog>
 </>;
}
