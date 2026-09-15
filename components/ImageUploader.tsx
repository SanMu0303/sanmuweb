"use client";
import './image-uploader.css';
import {useRef,useState,type ReactNode} from 'react';
import {IMAGE_CONFIG} from '@/config/images.mjs';
import type {ImageUploads} from '@/lib/useImageUploads';
import ImagePreviewGrid from './ImagePreviewGrid';
export default function ImageUploader({uploads,children,disabled=false}:{uploads:ImageUploads;children:ReactNode;disabled?:boolean}){
 const input=useRef<HTMLInputElement>(null);const [dragging,setDragging]=useState(false);const [url,setUrl]=useState('');
 return <div className={'image-uploader'+(dragging?' is-dragging':'')} onDragOver={e=>{if(!disabled&&e.dataTransfer.types.includes('Files')){e.preventDefault();setDragging(true)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}} onDrop={e=>{setDragging(false);if(e.dataTransfer.files.length){e.preventDefault();if(!disabled)uploads.addFiles(Array.from(e.dataTransfer.files))}}}>
 {children}{dragging&&<div className="upload-drop-hint">释放以上传图片</div>}
 <ImagePreviewGrid uploads={uploads}/>
 <div className="upload-controls"><button type="button" disabled={disabled} onClick={()=>input.current?.click()}>图片{uploads.items.length?` · ${uploads.items.length}/${IMAGE_CONFIG.maxImages}`:''}</button><span>最多 {IMAGE_CONFIG.maxImages} 张 · 单张 {IMAGE_CONFIG.maxFileBytes/1024/1024}MB · 合计 {IMAGE_CONFIG.maxTotalBytes/1024/1024}MB · 可拖入图片</span><input ref={input} type="file" aria-label="选择本地图片" accept={IMAGE_CONFIG.accept} multiple hidden disabled={disabled} onChange={e=>{uploads.addFiles(Array.from(e.target.files||[]));e.target.value=''}}/></div>
 <details className="image-url-option"><summary>通过 URL 添加图片</summary><textarea aria-label="图片链接" placeholder="每行一个 HTTPS 图片链接" value={url} onChange={e=>setUrl(e.target.value)} disabled={disabled}/><button type="button" disabled={disabled||!url.trim()} onClick={()=>{if(uploads.addUrls(url))setUrl('')}}>添加链接</button></details>
 {uploads.error&&<p role="alert">{uploads.error}</p>}{uploads.items.some(i=>i.status==='error')&&<p role="alert">请重试或删除上传失败的图片后再发布。</p>}
 </div>;
}
