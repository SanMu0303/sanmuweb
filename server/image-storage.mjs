import {IMAGE_CONFIG} from './image-config.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const idPattern=/^[a-f0-9-]{36}$/;
const referenced=`EXISTS (SELECT 1 FROM articles a, json_each(a.document, '$.images') i WHERE json_extract(i.value,'$.storagePath') = image_uploads.storage_path OR json_extract(i.value,'$.url') = '/api/images/' || image_uploads.id)`;
async function removeTemporary(env,id,owner){
 const row=await env.DB.prepare('SELECT * FROM image_uploads WHERE id = ? AND owner = ?').bind(id,owner).first();if(!row)return;
 const claim=await env.DB.prepare(`UPDATE image_uploads SET state = 'deleting' WHERE id = ? AND owner = ? AND state IN ('temporary','deleting') AND NOT ${referenced}`).bind(id,owner).run();
 if(!claim.meta.changes)fail('图片已关联记录，不能作为临时文件删除',409);
 await env.IMAGES.delete(row.storage_path);
 await env.DB.prepare("DELETE FROM image_uploads WHERE id = ? AND state = 'deleting'").bind(id).run();
}
async function cleanExpired(env,owner){
 const rows=await env.DB.prepare("SELECT id FROM image_uploads WHERE owner = ? AND state IN ('temporary','deleting') AND created_at < ? LIMIT 20").bind(owner,Date.now()-IMAGE_CONFIG.temporaryTtlMs).all();
 for(const r of rows.results)try{await removeTemporary(env,r.id,owner)}catch(e){console.error('Temporary image cleanup failed',e.message)}
}
function sniff(b){if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';if(b.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return 'image/png';if(b.length>=16&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';return ''}
async function limitedBytes(request){
 if(Number(request.headers.get('content-length'))>IMAGE_CONFIG.maxFileBytes)fail(`单张图片不能超过 ${IMAGE_CONFIG.maxFileBytes/1024/1024}MB`,413);
 const reader=request.body?.getReader();if(!reader)fail('请选择图片');const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>IMAGE_CONFIG.maxFileBytes){await reader.cancel();fail(`单张图片不能超过 ${IMAGE_CONFIG.maxFileBytes/1024/1024}MB`,413)}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes;
}
export async function imageApi(request,env,user,projectPost){
 if(!env.DB||!env.IMAGES)return json({error:'图片存储暂时不可用，请稍后重试'},503);
 const path=new URL(request.url).pathname;const owner=request.headers.get('oai-authenticated-user-id');
 if(path==='/api/admin/images'&&request.method==='POST'){
  const id=request.headers.get('x-image-id')||'';if(!idPattern.test(id))fail('图片标识不正确');
  const old=await env.DB.prepare('SELECT * FROM image_uploads WHERE id = ?').bind(id).first();if(old){if(old.owner!==owner||old.state!=='temporary')fail('图片标识已使用',409);return json(JSON.parse(old.document))}
  await cleanExpired(env,owner);
  const bytes=await limitedBytes(request);const mimeType=sniff(bytes);if(!mimeType||mimeType!==request.headers.get('content-type'))fail('只支持真实的 JPG、PNG、WebP 图片');
  const size=key=>{const v=Number(request.headers.get(key));return Number.isInteger(v)&&v>0&&v<=100000?v:0};
  const storagePath='posts/'+id;const image={id,url:'/api/images/'+id,thumbnailUrl:'/api/images/'+id,storagePath,width:size('x-image-width'),height:size('x-image-height'),mimeType,fileSize:bytes.length,sortOrder:0,alt:'研究配图',isPreview:false};
  await env.IMAGES.put(storagePath,bytes,{httpMetadata:{contentType:mimeType}});
  try{await env.DB.prepare("INSERT INTO image_uploads (id,owner,storage_path,document,state,post_slug,created_at) VALUES (?,?,?,?,'temporary',NULL,?)").bind(id,owner,storagePath,JSON.stringify(image),Date.now()).run()}catch(e){const concurrent=await env.DB.prepare('SELECT id FROM image_uploads WHERE id = ?').bind(id).first();if(!concurrent)await env.IMAGES.delete(storagePath);throw e}
  return json(image);
 }
 if(path.startsWith('/api/admin/images/')&&request.method==='DELETE'){
  const id=path.slice('/api/admin/images/'.length);if(!idPattern.test(id))fail('图片标识不正确');await removeTemporary(env,id,owner);return json({deleted:true});
 }
 if(path.startsWith('/api/images/')&&['GET','HEAD'].includes(request.method)){
  const id=path.slice('/api/images/'.length);if(!idPattern.test(id))return json({error:'图片不存在'},404);
  const row=await env.DB.prepare('SELECT * FROM image_uploads WHERE id = ?').bind(id).first();if(!row||row.state==='deleting')return json({error:'图片不存在'},404);
  let allowed=user.isAdmin&&row.owner===owner;
  if(!allowed){const records=await env.DB.prepare("SELECT document FROM articles WHERE status = 'published' AND EXISTS (SELECT 1 FROM json_each(articles.document, '$.images') i WHERE json_extract(i.value,'$.storagePath') = ?)").bind(row.storage_path).all();allowed=records.results.some(a=>projectPost(JSON.parse(a.document),user.isAdmin).images.some(i=>i.storagePath===row.storage_path))}
  if(!allowed)return json({error:'图片不存在或无权查看'},404);
  const obj=await env.IMAGES.get(row.storage_path);if(!obj)return json({error:'图片不存在'},404);
  const info=JSON.parse(row.document);return new Response(request.method==='HEAD'?null:obj.body,{headers:{'Content-Type':info.mimeType,'Content-Length':String(info.fileSize),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 return json({error:'图片接口不存在'},404);
}
export async function claimImages(env,images,owner,slug){
 const claimed=[];try{for(let index=0;index<images.length;index++){
  const image=images[index];const managed=image.url.startsWith('/api/images/');if(!managed){if(image.storagePath)fail('图片存储地址不正确');continue}
  const id=image.url.slice('/api/images/'.length);const row=await env.DB.prepare('SELECT * FROM image_uploads WHERE id = ? AND owner = ?').bind(id,owner).first();
  if(!row||!['temporary','attached'].includes(row.state)||(row.post_slug&&row.post_slug!==slug))fail('图片未上传完成或已被删除，请重新上传');
  const result=await env.DB.prepare("UPDATE image_uploads SET state = 'attached', post_slug = ? WHERE id = ? AND owner = ? AND state IN ('temporary','attached') AND (post_slug IS NULL OR post_slug = ?)").bind(slug,id,owner,slug).run();if(!result.meta.changes)fail('图片正在删除，请重新上传');
  claimed.push(id);images[index]={...JSON.parse(row.document),alt:image.alt,caption:image.caption,isPreview:image.isPreview,sortOrder:index};
 }if(images.reduce((n,i)=>n+(i.fileSize||0),0)>IMAGE_CONFIG.maxTotalBytes)fail(`单条动态图片总大小不能超过 ${IMAGE_CONFIG.maxTotalBytes/1024/1024}MB`);return claimed;
 }catch(e){await releaseClaims(env,claimed,slug);throw e}
}
export async function releaseClaims(env,ids,slug){for(const id of ids)await env.DB.prepare(`UPDATE image_uploads SET state = 'temporary', post_slug = NULL WHERE id = ? AND post_slug = ? AND NOT ${referenced}`).bind(id,slug).run()}
