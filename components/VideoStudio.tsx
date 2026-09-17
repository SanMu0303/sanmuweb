"use client";
import {useEffect,useRef,useState} from 'react';
import {request} from '@/lib/live';
import {VIDEO_CONFIG} from '@/config/videos.mjs';
import {uploadVideoCover,VIDEO_COVER_ACCEPT,type UploadedVideoCover} from '@/lib/videoCoverStorage';
import './video-studio.css';

type Entry={deletedAt?:string;id:string;revision:number;title:string;description:string;videoUrl:string;videoProvider:string;uploadId:string;thumbnail?:string;coverUploadId?:string;duration:number;category:string;tags:string[];isMemberOnly:boolean;status:string};
type CoverSelection={file:File|null;status:'idle'|'uploading'|'completing'|'ready'|'failed';progress:number;uploadedId?:string;result?:UploadedVideoCover;error:string};
const emptyCover=():CoverSelection=>({file:null,status:'idle',progress:0,error:''});
const blank=():Entry=>({id:'video-'+crypto.randomUUID(),revision:0,title:'',description:'',videoUrl:'',videoProvider:'youtube',uploadId:'',thumbnail:'',duration:0,category:'',tags:[],isMemberOnly:false,status:'draft'});
export default function VideoStudio(){
 const [entry,setEntry]=useState<Entry>(blank),[list,setList]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState('');
 const [cover,setCover]=useState<CoverSelection>(emptyCover),[coverPreview,setCoverPreview]=useState(''),[archiveTarget,setArchiveTarget]=useState<string|null>(null);
 const activeOperation=useRef(false);
 useEffect(()=>{request<Entry[]>('/api/admin/videos').then(setList).catch(e=>setError(e.message))},[]);
 useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
 useEffect(()=>{if(!cover.file){setCoverPreview('');return}const url=URL.createObjectURL(cover.file);setCoverPreview(url);return()=>URL.revokeObjectURL(url)},[cover.file]);
 const currentCover=entry.coverUploadId?'/api/admin/video-covers/'+encodeURIComponent(entry.coverUploadId):entry.thumbnail||'';
 const coverBlocked=!!cover.file&&cover.status!=='ready';
 const categories=[...new Set(list.filter(video=>!video.deletedAt).map(video=>video.category?.trim()).filter((category):category is string=>!!category))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 const change=(value:Partial<Entry>)=>{setEntry(current=>({...current,...value}));setNotice('');setArchiveTarget(null)};
 function chooseEntry(id:string){if(activeOperation.current)return;setEntry(list.find(video=>video.id===id)||blank());setFile(null);setCover(emptyCover());setError('');setNotice('');setArchiveTarget(null)}
 async function upload(f:File){
  if(activeOperation.current)return;setFile(f);change({uploadId:''});setError('');
  if(!VIDEO_CONFIG.mimeTypes.includes(f.type)||f.size>VIDEO_CONFIG.maxFileBytes){setError('请选择50MB以内的 MP4 / WebM 视频');return}
  activeOperation.current=true;setBusy(true);setProgress(0);
  try{const ticket=await request<{id:string;uploadUrl:string}>('/api/admin/video-uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mimeType:f.type,fileSize:f.size})});await new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',ticket.uploadUrl);xhr.setRequestHeader('Content-Type',f.type);xhr.timeout=VIDEO_CONFIG.uploadTimeoutMs;xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.round(e.loaded/e.total*100))};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('上传失败，请重试'));xhr.onerror=()=>reject(new Error('网络中断，请重试'));xhr.ontimeout=()=>reject(new Error('上传超时，请重试'));xhr.send(f)});change({uploadId:ticket.id});setNotice('视频上传完成，保存视频后生效。')}
  catch(e){setError((e as Error).message)}finally{activeOperation.current=false;setBusy(false)}
 }
 async function uploadCover(f:File,retryUploadedId?:string){
  if(activeOperation.current)return;activeOperation.current=true;setBusy(true);setError('');setNotice('');setArchiveTarget(null);
  setCover({file:f,status:retryUploadedId?'completing':'uploading',progress:retryUploadedId?100:0,uploadedId:retryUploadedId,error:''});
  try{
   const result=await uploadVideoCover(f,{uploadedId:retryUploadedId,onProgress:value=>setCover(current=>({...current,progress:value})),onUploaded:id=>setCover(current=>({...current,uploadedId:id,progress:100})),onStage:status=>setCover(current=>({...current,status}))});
   setCover(current=>({...current,result,status:'ready',progress:100}));setNotice('新封面已上传，保存视频后生效。');
  }catch(e){setCover(current=>({...current,status:'failed',error:(e as Error).message}))}finally{activeOperation.current=false;setBusy(false)}
 }
 function cancelCover(){if(activeOperation.current)return;setCover(emptyCover());setNotice('已取消本次封面选择。')}
 function removeCover(){if(activeOperation.current)return;setCover(emptyCover());change({coverUploadId:'',thumbnail:''});setNotice('已移除封面，保存视频后生效。')}
 async function archive(restore=false){
  if(activeOperation.current||(!restore&&archiveTarget!==entry.id))return;activeOperation.current=true;setBusy(true);setError('');setNotice('');
  try{const saved=await request<Entry>('/api/admin/videos',{method:restore?'PATCH':'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entry.id,revision:entry.revision})});setEntry(saved);setFile(null);setCover(emptyCover());setArchiveTarget(null);setList(current=>[saved,...current.filter(video=>video.id!==saved.id)]);setNotice(restore?'已恢复为草稿，确认后可重新发布。':'已移入回收站，已保存的视频和封面保留。')}
  catch(e){setError((e as Error).message)}finally{activeOperation.current=false;setBusy(false)}
 }
 async function save(status:string){
  if(activeOperation.current)return;
  if(coverBlocked){setError('请先完成封面上传，或取消本次封面选择后再保存。');return}
  activeOperation.current=true;setBusy(true);setError('');setNotice('');
  try{const saved=await request<Entry>('/api/admin/videos',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...entry,...(cover.result?{coverUploadId:cover.result.id}:{}),status})});setEntry(saved);setCover(emptyCover());setArchiveTarget(null);setList(current=>[saved,...current.filter(video=>video.id!==saved.id)]);setNotice(status==='published'?'视频已发布，知识库和首页动态流均可查看。':'已保存为草稿。')}
  catch(e){setError((e as Error).message)}finally{activeOperation.current=false;setBusy(false)}
 }
 return <section className="editor-panel video-studio"><h2>视频管理</h2><p>接入 Bilibili / YouTube，或上传本地 MP4 / WebM。</p>{error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <fieldset className="editor-fields" disabled={busy}>
   <label>已有视频<select value={list.some(video=>video.id===entry.id)?entry.id:''} onChange={e=>chooseEntry(e.target.value)}><option value="">新建视频</option>{list.map(video=><option key={video.id} value={video.id}>{video.title} · {video.deletedAt?'回收站':video.status==='published'?'已发布':'草稿'}</option>)}</select></label>
   <fieldset disabled={!!entry.deletedAt} className="video-studio-content">
    <label>视频来源<select value={entry.videoProvider==='selfHosted'?'upload':'link'} onChange={e=>{change({videoProvider:e.target.value==='upload'?'selfHosted':'youtube',videoUrl:'',uploadId:''});setFile(null)}}><option value="link">Bilibili / YouTube 链接</option><option value="upload">上传本地视频</option></select></label>
    {entry.videoProvider==='selfHosted'?<><label>选择视频（最大50MB）<input type="file" accept={VIDEO_CONFIG.accept} onChange={e=>{const chosen=e.target.files?.[0];e.currentTarget.value='';if(chosen)void upload(chosen)}}/></label>{preview&&<video controls preload="metadata" src={preview} className="video-source-preview" onLoadedMetadata={e=>change({duration:Math.round(e.currentTarget.duration)||0})}/>}<small>{busy&&cover.status!=='uploading'&&cover.status!=='completing'?`正在处理 / 上传 ${progress}%`:entry.uploadId?'文件已上传':'请选择视频文件'}</small>{file&&!entry.uploadId&&<button type="button" className="button secondary" onClick={()=>upload(file)}>重试视频上传</button>}</>:<label>视频链接<input placeholder="https://www.bilibili.com/video/BV… 或 YouTube 链接" value={entry.videoUrl} onChange={e=>change({videoUrl:e.target.value})}/></label>}
    <section className="video-cover-editor" aria-labelledby="video-cover-title"><h3 id="video-cover-title">视频封面</h3><p>链接视频和本地视频均可上传封面。支持 5MB 以内的 JPG、PNG、WebP，推荐 16:9。</p>
     <div className="video-cover-previews">{currentCover&&<figure><img src={currentCover} alt="当前视频封面"/><figcaption>当前封面</figcaption></figure>}{cover.file&&coverPreview&&<figure><img src={cover.result?.previewUrl||coverPreview} alt="待保存的新封面预览"/><figcaption>新封面预览 · 尚未保存</figcaption></figure>}{!currentCover&&!cover.file&&<div className="video-cover-empty">尚未设置封面，保存后使用默认封面。</div>}</div>
     <label>选择封面图片<input type="file" accept={VIDEO_COVER_ACCEPT} onChange={e=>{const chosen=e.target.files?.[0];e.currentTarget.value='';if(chosen)void uploadCover(chosen)}}/></label>
     {(cover.status==='uploading'||cover.status==='completing')&&<p role="status" className="video-cover-progress">{cover.status==='completing'?'正在确认封面…':`正在上传封面 ${cover.progress}%`}</p>}
     {cover.status==='ready'&&<p role="status" className="video-cover-ready">封面上传完成，点击下方保存后生效。</p>}
     {cover.status==='failed'&&<div className="notice error" role="alert"><p>{cover.error}</p><p>{currentCover?'原封面保持不变。请重试，或取消本次更换后继续保存。':'请重试，或取消本次封面选择后继续保存。'}</p></div>}
     <div className="actions">{cover.status==='failed'&&cover.file&&<button type="button" className="button secondary" onClick={()=>uploadCover(cover.file!,cover.uploadedId)}>{cover.uploadedId?'重试确认封面':'重试上传封面'}</button>}{cover.file&&<button type="button" className="button secondary" onClick={cancelCover}>{currentCover?'取消更换，保留当前封面':'取消封面选择'}</button>}{currentCover&&<button type="button" className="button secondary" onClick={removeCover}>移除封面</button>}</div>
    </section>
    <label>视频标题<input maxLength={180} value={entry.title} onChange={e=>change({title:e.target.value})}/></label>
    <label>简介<textarea rows={4} value={entry.description} onChange={e=>change({description:e.target.value})}/></label>
    <div className="editor-row"><label>分类<input list="video-existing-categories" maxLength={80} placeholder="自定义分类，留空为未分类" value={entry.category} onChange={e=>change({category:e.target.value})}/><datalist id="video-existing-categories">{categories.map(category=><option key={category} value={category}/>)}</datalist></label><label>时长（秒）<input type="number" min={0} value={entry.duration} onChange={e=>change({duration:Number(e.target.value)})}/></label></div>
    <label>标签（逗号分隔）<input value={entry.tags.join(',')} onChange={e=>change({tags:e.target.value.split(/[,，]/)})}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={entry.isMemberOnly} onChange={e=>change({isMemberOnly:e.target.checked})}/>会员内容</label>
    {coverBlocked&&<p className="video-cover-save-hint">封面尚未就绪，完成上传或取消本次选择后才可保存。</p>}
    <div className="editor-actions"><button type="button" className="button secondary" disabled={coverBlocked} onClick={()=>save('draft')}>保存草稿 / 下架</button><button type="button" className="button" disabled={coverBlocked||!entry.title.trim()||(entry.videoProvider==='selfHosted'&&!entry.uploadId)} onClick={()=>save('published')}>{entry.status==='published'?'更新视频':'发布视频'}</button>{entry.revision>0&&<a href={'/video/?id='+encodeURIComponent(entry.id)} target="_blank" rel="noreferrer">查看视频 ↗</a>}</div>
   </fieldset>
   {entry.deletedAt?<button type="button" className="button secondary" onClick={()=>archive(true)}>恢复为草稿</button>:(entry.revision>0||list.some(video=>video.id===entry.id))&&<button type="button" className="button secondary" onClick={()=>{setArchiveTarget(entry.id);setError('');setNotice('')}}>移入回收站</button>}
   {archiveTarget===entry.id&&<section className="notice video-archive-confirm" role="group" aria-label="视频回收确认"><p>确认将「{entry.title||'未命名视频'}」移入回收站？前台将不再显示，已保存的视频和封面保留，可恢复为草稿。</p><div className="actions"><button type="button" className="button" onClick={()=>archive()}>确认移入回收站</button><button type="button" className="button secondary" onClick={()=>setArchiveTarget(null)}>取消</button></div></section>}
  </fieldset>
 </section>;
}
