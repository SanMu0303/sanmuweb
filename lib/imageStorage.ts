import {IMAGE_CONFIG} from '@/config/images.mjs';
import type {PostImage} from './posts';
export async function uploadImage(file:File,id:string):Promise<PostImage>{
 const url=URL.createObjectURL(file);
 let width=0,height=0;
 try{const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>{width=img.naturalWidth;height=img.naturalHeight;resolve()};img.onerror=()=>reject(new Error('图片无法读取，请选择有效图片'));img.src=url})}finally{URL.revokeObjectURL(url)}
 const options={method:'POST',headers:{'Content-Type':'application/json'}};
 const response=await fetch('/api/admin/images/',{...options,body:JSON.stringify({id,mimeType:file.type,fileSize:file.size,width,height})});
 const ticket=await response.json();if(!response.ok)throw new Error(ticket.error||'上传失败，请重试');if(ticket.image)return ticket.image;
 const uploaded=await fetch(ticket.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file,signal:AbortSignal.timeout(IMAGE_CONFIG.uploadTimeoutMs)});
 // A previous upload may have succeeded before the response was lost. Completion
 // verifies the stored bytes, so retry can safely recover without overwriting.
 if(!uploaded.ok&&![400,409].includes(uploaded.status))throw new Error('上传失败，请重试');
 const completed=await fetch('/api/admin/images/'+encodeURIComponent(id)+'/complete/',{...options,body:'{}'});
 const data=await completed.json();if(!completed.ok)throw new Error(data.error||'图片校验失败，请重试');return data;
}
export async function deleteImage(id:string):Promise<void>{
 const response=await fetch('/api/admin/images/'+encodeURIComponent(id),{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});
 if(!response.ok){const data=await response.json();throw new Error(data.error||'删除失败，请重试')}
}
