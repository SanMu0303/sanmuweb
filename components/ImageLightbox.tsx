"use client";
import {useEffect,useRef} from 'react';
import type {PostImage} from '@/lib/posts';
export default function ImageLightbox({images,index,onIndex,onClose}:{images:PostImage[];index:number;onIndex:(index:number)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);const start=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.showModal();return()=>{document.body.style.overflow=previous}},[]);
 const move=(delta:number)=>onIndex((index+delta+images.length)%images.length);const current=images[index];
 return <dialog ref={dialog} className="image-lightbox" aria-label="研究图片原图" onClose={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();move(1)}if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}}}>
 <div className="lightbox-toolbar"><span aria-live="polite">{index+1} / {images.length}</span><a href={current.url} target="_blank" rel="noreferrer">打开原图 ↗</a><button type="button" onClick={onClose} autoFocus aria-label="关闭原图">关闭 ×</button></div>
 <img src={current.url} alt={current.alt} onTouchStart={e=>{start.current={x:e.touches[0].clientX,y:e.touches[0].clientY}}} onTouchEnd={e=>{if(!start.current)return;const dx=e.changedTouches[0].clientX-start.current.x,dy=e.changedTouches[0].clientY-start.current.y;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);start.current=null}}/>
 <p>{current.caption||current.alt}</p>{images.length>1&&<div className="lightbox-paging"><button type="button" onClick={()=>move(-1)}>← 上一张</button><button type="button" onClick={()=>move(1)}>下一张 →</button></div>}
 </dialog>;
}
