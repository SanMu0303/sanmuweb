"use client";
import {useRef,useState} from 'react';
import type {PostImage} from '@/lib/posts';
import ImageLightbox from './ImageLightbox';
import './image-gallery.css';
export default function PostImages({images}:{images:PostImage[]}){
 const [index,setIndex]=useState<number|null>(null);const [failed,setFailed]=useState<Set<number>>(()=>new Set());const trigger=useRef<HTMLButtonElement|null>(null);if(!images.length)return null;
 return <><div className={'post-thumbnails '+(images.length>1?'multiple':'single')} style={images.length>1?{gridTemplateColumns:`repeat(${images.length===2||images.length===4?2:3},minmax(0,1fr))`}:undefined}>
 {images.map((image,i)=>{const isFailed=failed.has(i);return <button key={(image.id||image.url)+i} type="button" className={isFailed?'is-failed':''} onClick={e=>{if(isFailed)return;trigger.current=e.currentTarget;setIndex(i)}} aria-label={isFailed?'图片加载失败：'+image.alt:'放大图片：'+image.alt} aria-disabled={isFailed||undefined}>
   {isFailed?<span className="image-fallback" role="status">图片暂时无法加载</span>:<><img src={image.thumbnailUrl||image.url} alt={image.alt} loading="lazy" onError={()=>setFailed(previous=>{const next=new Set(previous);next.add(i);return next})}/><span>放大 ↗</span></>}
  </button>})}
 </div>{index!==null&&<ImageLightbox images={images} index={index} onIndex={setIndex} onClose={()=>{setIndex(null);trigger.current?.focus()}}/>}</>;
}
