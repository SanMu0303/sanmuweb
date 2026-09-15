"use client";
import {useEffect,useRef,useState} from 'react';
import {IMAGE_CONFIG} from '@/config/images.mjs';
import {uploadImage,deleteImage} from './imageStorage';
import type {PostImage} from './posts';
export type UploadItem={id:string;file?:File;preview:string;status:'waiting'|'uploading'|'success'|'error';image?:PostImage;error?:string;deleting?:boolean};
export function useImageUploads(){
 const [items,setItems]=useState<UploadItem[]>([]),[error,setError]=useState('');
 const current=useRef(items);current.current=items;
 const running=useRef<{id:string;promise:Promise<unknown>}|null>(null);
 const blobUrls=useRef(new Set<string>());
 const patch=(id:string,update:Partial<UploadItem>)=>setItems(list=>list.map(i=>i.id===id?{...i,...update}:i));
 useEffect(()=>{if(running.current)return;const item=items.find(i=>i.status==='waiting'&&!i.deleting);if(!item?.file)return;
  patch(item.id,{status:'uploading',error:undefined});
  const promise=uploadImage(item.file,item.id).then(image=>{running.current=null;patch(item.id,{status:'success',image})}).catch(e=>{running.current=null;patch(item.id,{status:'error',error:(e as Error).message})});
  running.current={id:item.id,promise};
 },[items]);
 useEffect(()=>()=>{for(const url of blobUrls.current)URL.revokeObjectURL(url)},[]);
 function addFiles(files:File[]){
  setError('');
  setItems(list=>{
   if(list.length+files.length>IMAGE_CONFIG.maxImages){setError(`单条动态最多上传${IMAGE_CONFIG.maxImages}张图片`);return list}
   if(files.some(f=>!IMAGE_CONFIG.mimeTypes.includes(f.type))){setError('只支持 JPG、PNG、WebP 图片');return list}
   if(files.some(f=>f.size>IMAGE_CONFIG.maxFileBytes)){setError(`单张图片不能超过 ${IMAGE_CONFIG.maxFileBytes/1024/1024}MB`);return list}
   if(files.reduce((n,f)=>n+f.size,0)+list.reduce((n,i)=>n+(i.file?.size||i.image?.fileSize||0),0)>IMAGE_CONFIG.maxTotalBytes){setError(`单条动态图片总大小不能超过 ${IMAGE_CONFIG.maxTotalBytes/1024/1024}MB`);return list}
   return [...list,...files.map(file=>{const preview=URL.createObjectURL(file);blobUrls.current.add(preview);return {id:crypto.randomUUID(),file,preview,status:'waiting' as const}})];
  });
 }
 async function remove(id:string){
  const item=current.current.find(i=>i.id===id);if(!item||item.deleting)return;patch(id,{deleting:true});
  try{if(running.current?.id===id)await running.current.promise;
   if(item.file)await deleteImage(id);
   if(blobUrls.current.has(item.preview)){URL.revokeObjectURL(item.preview);blobUrls.current.delete(item.preview)}
   setItems(list=>list.filter(i=>i.id!==id));setError('');
  }catch(e){patch(id,{deleting:false});setError((e as Error).message)}
 }
 function move(id:string,target:string){setItems(list=>{const from=list.findIndex(i=>i.id===id),to=list.findIndex(i=>i.id===target);if(from<0||to<0)return list;const next=[...list];next.splice(to,0,next.splice(from,1)[0]);return next})}
 function retry(id:string){patch(id,{status:'waiting',error:undefined})}
 function addUrls(value:string){const urls=value.split(/\s+/).filter(Boolean);if(urls.some(url=>!(/^https:\/\//.test(url)||(url.startsWith('/')&&!url.startsWith('//')&&!url.includes('\\'))))){setError('请输入 HTTPS 图片链接或本站路径');return false}
  if(current.current.length+urls.length>IMAGE_CONFIG.maxImages){setError(`单条动态最多上传${IMAGE_CONFIG.maxImages}张图片`);return false}
  setItems(list=>[...list,...urls.map(url=>{const id=crypto.randomUUID();return {id,preview:url,status:'success' as const,image:{id,url,thumbnailUrl:url,alt:'研究配图',isPreview:false}}})]);setError('');return true;
 }
 function reset(images:PostImage[]=[]){for(const url of blobUrls.current)URL.revokeObjectURL(url);blobUrls.current.clear();setItems(images.map((image,index)=>({id:image.id||'existing-'+index,preview:image.thumbnailUrl||image.url,status:'success',image})));setError('')}
 const uploading=items.some(i=>i.status==='waiting'||i.status==='uploading');
 const blocked=items.some(i=>i.status!=='success'||i.deleting);
 const images=items.filter(i=>i.image).map((i,index)=>({...i.image!,sortOrder:index}));
 return {items,error,addFiles,remove,move,retry,addUrls,reset,uploading,blocked,images};
}
export type ImageUploads=ReturnType<typeof useImageUploads>;
