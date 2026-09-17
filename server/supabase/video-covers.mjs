import {createSupabase} from './client.mjs';

export const VIDEO_COVER_CONFIG=Object.freeze({bucket:'research-video-covers',maxFileBytes:5*1024*1024,mimeTypes:['image/jpeg','image/png','image/webp'],signedUrlSeconds:60});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const change=(method,value)=>({method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(value)});
const json=value=>Response.json(value,{headers:{'Cache-Control':'private, no-store'}});
const preview=id=>({id,previewUrl:'/api/admin/video-covers/'+id});
const text=bytes=>String.fromCharCode(...bytes);
function mimeOf(bytes){
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
 if(bytes.length>=45&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&text(bytes.slice(12,16))==='IHDR'&&text(bytes.slice(-8,-4))==='IEND')return 'image/png';
 if(bytes.length>=20&&text(bytes.slice(0,4))==='RIFF'&&text(bytes.slice(8,12))==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(text(bytes.slice(12,16)))&&new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)===bytes.length-8)return 'image/webp';
 return '';
}
async function verifiedBytes(response,expected){
 if(!response.ok||response.status!==200||!response.body)fail('封面尚未上传成功，请重试',409);
 const advertised=response.headers.get('content-length');
 if(advertised!==null&&Number(advertised)!==expected)fail('封面文件大小与上传信息不一致');
 const reader=response.body.getReader(),parts=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>expected||length>VIDEO_COVER_CONFIG.maxFileBytes)fail('封面文件大小与上传信息不一致');parts.push(value)}}finally{await reader.cancel()}
 if(length!==expected)fail('封面文件大小与上传信息不一致');
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}return bytes;
}
export function createVideoCovers(client=createSupabase(),transport=fetch){
 const config=VIDEO_COVER_CONFIG;
 const query=(id,extra={})=>'/rest/v1/video_cover_uploads?'+new URLSearchParams({id:'eq.'+id,...extra});
 async function row(id){if(!validId(id))return null;return (await client.request(query(id,{select:'id,owner,storage_path,mime_type,file_size,state',limit:'1'})))[0]||null}
 function storageUrl(relative){
  if(typeof relative!=='string'||!relative.startsWith('/object/'))throw new Error('Invalid cover storage URL');
  const url=new URL('/storage/v1'+relative,client.config.url);
  if(url.origin!==client.config.url||url.username||url.password||!url.pathname.startsWith('/storage/v1/object/'))throw new Error('Invalid cover storage URL');
  return url.toString();
 }
 async function sign(current){
  if(!validId(current.id)||current.storage_path!=='covers/'+current.id)throw new Error('Invalid cover storage path');
  const result=await client.request('/storage/v1/object/sign/'+config.bucket+'/'+current.storage_path,change('POST',{expiresIn:config.signedUrlSeconds}));
  return storageUrl(result.signedURL);
 }
 async function redirect(current){return new Response(null,{status:302,headers:{Location:await sign(current),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}})}
 return {
  // Omission supports old clients. Explicit empty string removes the association.
  async select(input,existing,user){
   const id=Object.hasOwn(input,'coverUploadId')?input.coverUploadId:existing?.coverUploadId||'';
   if(id==='')return {coverUploadId:'',thumbnail:'/charts/btc-range.svg'};
   if(!validId(id))fail('封面标识不正确');
   const current=await row(id);
   if(!current||current.state!=='complete'||(current.owner!==user.id&&existing?.coverUploadId!==id))fail('请先完成封面上传，或重新选择自己的封面');
   return {coverUploadId:id,thumbnail:'/api/video-covers/'+input.id};
  },
  async handle(request,user,repo){
   const path=new URL(request.url).pathname.replace(/\/$/,''),method=request.method;
   if(path.startsWith('/api/admin/')&&!user?.isAdmin)fail('没有封面管理权限',user?.signedIn?403:401);
   if(path==='/api/admin/video-covers'&&method==='POST'){
    const input=await request.json();
    if(!config.mimeTypes.includes(input?.mimeType)||!Number.isInteger(input?.fileSize)||input.fileSize<=0||input.fileSize>config.maxFileBytes)fail('请选择5MB以内的 JPG、PNG 或 WebP 封面');
    const id=crypto.randomUUID(),storage_path='covers/'+id;
    await client.request('/rest/v1/video_cover_uploads',change('POST',{id,owner:user.id,storage_path,mime_type:input.mimeType,file_size:input.fileSize,state:'waiting'}));
    // No upsert permission: a completed object's bytes must stay immutable.
    const result=await client.request('/storage/v1/object/upload/sign/'+config.bucket+'/'+storage_path,change('POST',{}));
    return json({id,uploadUrl:storageUrl(result.url)});
   }
   if(/^\/api\/admin\/video-covers\/[^/]+\/complete$/.test(path)&&method==='POST'){
    const id=path.split('/')[4],current=await row(id);
    if(!current||current.owner!==user.id)fail('封面不存在或无权使用',404);
    if(current.state==='complete')return json(preview(id));
    if(current.state!=='waiting')fail('封面上传状态不正确',409);
    const response=await transport(await sign(current),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
    const bytes=await verifiedBytes(response,Number(current.file_size));
    const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if(mime!==current.mime_type||mimeOf(bytes)!==current.mime_type)fail('封面内容或格式与上传信息不一致');
    const saved=await client.request(query(id,{owner:'eq.'+user.id,state:'eq.waiting'}),change('PATCH',{state:'complete',completed_at:new Date().toISOString()}));
    if(!saved?.length){const latest=await row(id);if(latest?.owner!==user.id||latest.state!=='complete')fail('封面上传状态已变化，请重试',409)}
    return json(preview(id));
   }
   if(/^\/api\/admin\/video-covers\/[^/]+$/.test(path)&&['GET','HEAD'].includes(method)){
    const current=await row(path.split('/')[4]);
    if(!current||current.state!=='complete')fail('封面不存在',404);
    if(current.owner!==user.id&&!(await repo.list('videos')).some(video=>video.coverUploadId===current.id))fail('封面不存在',404);
    return redirect(current);
   }
   if(/^\/api\/video-covers\/[^/]+$/.test(path)&&['GET','HEAD'].includes(method)){
    const id=path.split('/')[3];if(!/^video-[a-z0-9-]+$/.test(id))fail('封面不存在',404);
    const video=await repo.get('videos',id);
    if(!video||video.status!=='published'||video.deletedAt||!video.coverUploadId)fail('封面不存在',404);
    const current=await row(video.coverUploadId);if(!current||current.state!=='complete')fail('封面不存在',404);
    return redirect(current);
   }
   fail('封面接口不存在',404);
  }
 };
}
