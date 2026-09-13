import {IMAGE_CONFIG} from '@/config/images.mjs';
import type {PostImage} from './posts';
export async function uploadImage(file:File,id:string):Promise<PostImage>{
 const url=URL.createObjectURL(file);
 let width=0,height=0;
 try{const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>{width=img.naturalWidth;height=img.naturalHeight;resolve()};img.onerror=()=>reject(new Error('图片无法读取，请选择有效图片'));img.src=url})}finally{URL.revokeObjectURL(url)}
 const response=await fetch('/api/admin/images',{method:'POST',headers:{'Content-Type':file.type,'X-Image-Id':id,'X-Image-Width':String(width),'X-Image-Height':String(height)},body:file,signal:AbortSignal.timeout(IMAGE_CONFIG.uploadTimeoutMs)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'上传失败，请重试');return data;
}
export async function deleteImage(id:string):Promise<void>{
 const response=await fetch('/api/admin/images/'+encodeURIComponent(id),{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});
 if(!response.ok){const data=await response.json();throw new Error(data.error||'删除失败，请重试')}
}
