import {createSupabase} from './client.mjs';
import {IMAGE_CONFIG} from '../../config/images.mjs';
import {projectPost} from '../post-model.mjs';
import {isEndedWatch} from '../watch-model.mjs';
import {canReadMemberContent,memberAssetLifetime} from '../member-access.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const validId=id=>/^[a-f0-9-]{36}$/.test(id);
const sniff=b=>b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)?'image/png':b.length>=16&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'?'image/webp':'';
export function createImages(client=createSupabase(),transport=fetch){
 const base='/storage/v1',bucket=encodeURIComponent(client.config.bucket);
 const query=(id,extra={})=>'/rest/v1/image_uploads?'+new URLSearchParams({id:'eq.'+id,...extra});
 const change=(method,body)=>({method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});
 async function row(id){if(!validId(id))fail('图片标识不正确');return (await client.request(query(id,{select:'*'})))[0]}
 function signedUrl(path){const url=new URL(path,client.config.url+base+'/');if(url.origin!==client.config.url||!url.pathname.startsWith('/storage/v1/'))throw new Error('Invalid storage URL');return url.toString()}
 async function download(path,expiresIn=60){const data=await client.request(base+'/object/sign/'+bucket+'/'+path,change('POST',{expiresIn}));return signedUrl(base+data.signedURL)}
 async function cleanExpired(owner){
  const expired=await client.request('/rest/v1/image_uploads?'+new URLSearchParams({owner:'eq.'+owner,state:'in.(waiting,temporary,deleting)',created_at:'lt.'+(Date.now()-IMAGE_CONFIG.temporaryTtlMs),limit:'20',select:'id'}));
  for(const item of expired){
   try{const old=await client.request('/rest/v1/rpc/mark_temporary_image_deleting',change('POST',{p_id:item.id,p_owner:owner}));if(!old)continue;await client.request(base+'/object/'+bucket,change('DELETE',{prefixes:[old.storage_path]}));await client.request(query(item.id,{state:'eq.deleting'}),{method:'DELETE'});}catch{console.warn('Expired image cleanup deferred')}
  }
 }
 return {
  async handle(request,user,repo){
   const path=new URL(request.url).pathname.replace(/\/$/,'');
   if(path==='/api/admin/images'&&request.method==='POST'){
    const input=await request.json(),{id,mimeType,fileSize,width,height}=input;if(!validId(id)||!IMAGE_CONFIG.mimeTypes.includes(mimeType)||!Number.isInteger(fileSize)||fileSize<=0||fileSize>IMAGE_CONFIG.maxFileBytes)fail('图片格式或大小不正确');
    await cleanExpired(user.id);
    let current=await row(id);
    if(!current){const image={id,url:'/api/images/'+id,thumbnailUrl:'/api/images/'+id,storagePath:'posts/'+id,width:Number.isInteger(width)&&width>0&&width<=100000?width:0,height:Number.isInteger(height)&&height>0&&height<=100000?height:0,mimeType,fileSize,sortOrder:0,alt:'研究配图',isPreview:false};
     try{await client.request('/rest/v1/image_uploads',change('POST',{id,owner:user.id,storage_path:image.storagePath,document:image,state:'waiting',created_at:Date.now()}))}catch(e){if(e.status!==409)throw e}
     current=await row(id);
    }
    if(current.owner!==user.id||!['waiting','temporary'].includes(current.state))fail('图片标识已使用',409);
    if(current.state==='temporary')return json({image:current.document});
    await client.request(query(id,{state:'eq.waiting'}),change('PATCH',{created_at:Date.now()}));
    const data=await client.request(base+'/object/upload/sign/'+bucket+'/'+current.storage_path,change('POST',{}));
    return json({uploadUrl:signedUrl(base+data.url),id});
   }
   if(path.match(/^\/api\/admin\/images\/[^/]+\/complete$/)&&request.method==='POST'){
    const id=path.split('/')[4],current=await row(id);if(!current||current.owner!==user.id||!['waiting','temporary'].includes(current.state))fail('图片不存在或无权使用',404);
    if(current.state==='temporary')return json(current.document);
    const url=await download(current.storage_path);const response=await transport(url,{headers:{Range:'bytes=0-23'},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)fail('图片尚未上传成功',409);
    const size=Number(response.headers.get('content-range')?.split('/')[1]||response.headers.get('content-length'));
    const reader=response.body.getReader();let bytes=new Uint8Array();try{while(bytes.length<24){const part=await reader.read();if(part.done)break;const joined=new Uint8Array(bytes.length+part.value.length);joined.set(bytes);joined.set(part.value,bytes.length);bytes=joined}}finally{await reader.cancel()}
    if(size!==current.document.fileSize||size>IMAGE_CONFIG.maxFileBytes||sniff(bytes)!==current.document.mimeType)fail('图片内容或大小与上传信息不一致');
    const saved=await client.request(query(id,{owner:'eq.'+user.id,state:'eq.waiting'}),change('PATCH',{state:'temporary'}));if(!saved.length){const latest=await row(id);if(latest?.state!=='temporary')fail('图片已被删除',409)}
    return json(current.document);
   }
   if(path.startsWith('/api/admin/images/')&&request.method==='DELETE'){
    const id=path.split('/')[4];if(!validId(id))fail('图片标识不正确');
    const current=await client.request('/rest/v1/rpc/mark_temporary_image_deleting',change('POST',{p_id:id,p_owner:user.id}));
    // Retain tombstone until outstanding signed upload tickets have expired.
    if(current){await client.request(base+'/object/'+bucket,change('DELETE',{prefixes:[current.storage_path]}));}
    return json({deleted:true});
   }
   if(path.startsWith('/api/images/')&&['GET','HEAD'].includes(request.method)){
    const current=await row(path.split('/')[3]);if(!current||!['temporary','attached'].includes(current.state))fail('图片不存在',404);
    let allowed=user.isAdmin&&current.owner===user.id,requiresMembership=false;
    if(!allowed&&current.state==='attached'&&current.post_slug?.startsWith('watch:')){
      const watch=await repo.get('watch_items',current.post_slug.slice(6),{preferId:true});
      const attached=!!watch?.images?.some(i=>i.url==='/api/images/'+current.id&&i.storagePath===current.storage_path);
      if(attached){
        const ended=isEndedWatch(watch);
        allowed=ended||canReadMemberContent(user);
        requiresMembership=!ended;
      }
      // A historical image remains available for a public ended cycle, but
      // must not become a backdoor while that cycle is still active.
      if(!allowed&&repo.history){
        const history=await repo.history(current.post_slug.slice(6));
        const found=history.find(h=>h.document?.images?.some(i=>i.url==='/api/images/'+current.id&&i.storagePath===current.storage_path));
        if(found){
          const ended=isEndedWatch(watch);
          allowed=ended||canReadMemberContent(user);
          requiresMembership=!ended;
        }
      }
    }
    // Watch images are authorized against the watch cycle above. Do not
    // reinterpret a `watch:` storage key as an article in legacy adapters.
    if(!allowed&&current.post_slug&&!current.post_slug.startsWith('watch:')){
      const post=await repo.get('articles',current.post_slug,{publishedOnly:true});
      const imageUrl='/api/images/'+current.id;
      const memberImages=post?projectPost(post,canReadMemberContent(user)).images:[];
      const publicImages=post?projectPost(post,false).images:[];
      allowed=!!post&&memberImages.some(i=>i.url===imageUrl||i.id===current.id);
      requiresMembership=allowed&&post.access!=='public'&&!publicImages.some(i=>i.url===imageUrl||i.id===current.id);
    }
    if(!allowed)fail('图片不存在或无权查看',404);
    const expiresIn=requiresMembership?memberAssetLifetime(user):60;
    if(!expiresIn)fail('图片不存在或无权查看',404);
    return new Response(null,{status:302,headers:{Location:await download(current.storage_path,expiresIn),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
   }
   return json({error:'图片接口不存在'},404);
  }
 };
}
