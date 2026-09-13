"use client";
import {useRef,useState} from 'react';
import type {PostImage} from '@/lib/posts';
import ImageLightbox from './ImageLightbox';
import './image-gallery.css';
export default function PostImages({images}:{images:PostImage[]}){
 const [index,setIndex]=useState<number|null>(null);const trigger=useRef<HTMLButtonElement|null>(null);if(!images.length)return null;
 return <><div className={'post-thumbnails '+(images.length>1?'multiple':'single')} style={images.length>1?{gridTemplateColumns:`repeat(${images.length===2||images.length===4?2:3},minmax(0,1fr))`}:undefined}>
 {images.map((image,i)=><button key={(image.id||image.url)+i} type="button" onClick={e=>{trigger.current=e.currentTarget;setIndex(i)}} aria-label={'放大图片：'+image.alt}><img src={image.thumbnailUrl||image.url} alt={image.alt} loading="lazy"/><span>放大 ↗</span></button>)}
 </div>{index!==null&&<ImageLightbox images={images} index={index} onIndex={setIndex} onClose={()=>{setIndex(null);trigger.current?.focus()}}/>}</>;
}
