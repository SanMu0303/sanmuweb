"use client";
import {request} from './live';

export const VIDEO_COVER_ACCEPT='image/jpeg,image/png,image/webp';
export const VIDEO_COVER_MAX_BYTES=5*1024*1024;
export type UploadedVideoCover={id:string;previewUrl:string};
type UploadOptions={uploadedId?:string;onProgress:(progress:number)=>void;onUploaded:(id:string)=>void;onStage:(stage:'uploading'|'completing')=>void};
export function validateVideoCover(file:File){
 if(!VIDEO_COVER_ACCEPT.split(',').includes(file.type)||file.size<=0||file.size>VIDEO_COVER_MAX_BYTES)throw new Error('请选择 5MB 以内的 JPG、PNG 或 WebP 封面图片。');
}
export async function uploadVideoCover(file:File,options:UploadOptions):Promise<UploadedVideoCover>{
 validateVideoCover(file);
 let uploadedId=options.uploadedId;
 if(!uploadedId){
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file)}catch{throw new Error('封面图片无法读取，请重新选择 JPG、PNG 或 WebP 图片。')}
  const valid=bitmap.width>0&&bitmap.height>0;bitmap.close();if(!valid)throw new Error('封面图片尺寸无效，请重新选择。');
  options.onStage('uploading');
  const ticket=await request<{id:string;uploadUrl:string}>('/api/admin/video-covers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mimeType:file.type,fileSize:file.size})});
  await new Promise<void>((resolve,reject)=>{
   const xhr=new XMLHttpRequest();xhr.open('PUT',ticket.uploadUrl);xhr.setRequestHeader('Content-Type',file.type);xhr.timeout=120000;
   xhr.upload.onprogress=event=>{if(event.lengthComputable)options.onProgress(Math.round(event.loaded/event.total*100))};
   xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('封面文件上传失败，请重试。'));
   xhr.onerror=()=>reject(new Error('网络中断，封面上传未完成，请重试。'));
   xhr.ontimeout=()=>reject(new Error('封面文件上传超时，请重试。'));
   xhr.onabort=()=>reject(new Error('封面上传已取消，请重试或取消本次选择。'));
   xhr.send(file);
  });
  uploadedId=ticket.id;options.onUploaded(uploadedId);
 }
 options.onStage('completing');
 const result=await request<UploadedVideoCover>('/api/admin/video-covers/'+encodeURIComponent(uploadedId)+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(result.id!==uploadedId||!result.previewUrl)throw new Error('封面确认结果异常，请重试确认。');
 return result;
}
