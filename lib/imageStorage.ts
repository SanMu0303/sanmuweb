import {IMAGE_CONFIG} from '@/config/images.mjs';
import type {PostImage} from './posts';
import {request} from './live';
export async function uploadImage(file:File,id:string):Promise<PostImage>{
 const url=URL.createObjectURL(file);
 let width=0,height=0;
 try{const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>{width=img.naturalWidth;height=img.naturalHeight;resolve()};img.onerror=()=>reject(new Error('图片无法读取，请选择有效图片'));img.src=url})}finally{URL.revokeObjectURL(url)}
 const options={method:'POST' as const,headers:{'Content-Type':'application/json'}};
 const ticket=await request<{image?:PostImage;uploadUrl:string}>('/api/admin/images/',{...options,body:JSON.stringify({id,mimeType:file.type,fileSize:file.size,width,height})});
 if(ticket.image)return ticket.image;
 const uploaded=await fetch(ticket.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file,signal:AbortSignal.timeout(IMAGE_CONFIG.uploadTimeoutMs)});
 // A previous upload may have succeeded before the response was lost. Completion
 // verifies the stored bytes, so retry can safely recover without overwriting.
 if(!uploaded.ok&&![400,409].includes(uploaded.status))throw new Error('上传失败，请重试');
 return request<PostImage>('/api/admin/images/'+encodeURIComponent(id)+'/complete/',{...options,body:'{}'});
}
export async function deleteImage(id:string):Promise<void>{
 await request('/api/admin/images/'+encodeURIComponent(id),{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});
}
