import {createSupabase} from './client.mjs';
import {VIDEO_CONFIG as config} from '../../config/videos.mjs';
import {videoSource} from '../video-source.mjs';
import {canReadMemberContent,memberAssetLifetime} from '../member-access.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const change=(method,data)=>({method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(data)});
export function createVideos(client=createSupabase(),transport=fetch,examples=[]){
 const bucket=config.bucket;
 const get=async id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)?null:(await client.request('/rest/v1/video_uploads?'+new URLSearchParams({id:'eq.'+id,select:'*',limit:'1'})))[0];
 const sign=async(path,expiresIn=3600)=>{const d=await client.request('/storage/v1/object/sign/'+bucket+'/'+path,change('POST',{expiresIn}));return client.config.url+'/storage/v1'+d.signedURL};
 return {async handle(request,user,repo){const path=new URL(request.url).pathname.replace(/\/$/,'');
 if(path.startsWith('/api/video-files/')&&['GET','HEAD'].includes(request.method)){
 const id=path.split('/')[3];const video=await repo.get('videos',id);if(!video||video.status!=='published'||video.deletedAt||(video.isMemberOnly&&!canReadMemberContent(user)))fail('视频不存在或没有播放权限',404);
 const upload=await get(video.uploadId);if(!upload)fail('视频文件不存在',404);
 const expiresIn=video.isMemberOnly?memberAssetLifetime(user):3600;if(!expiresIn)fail('视频不存在或没有播放权限',404);
 return new Response(null,{status:302,headers:{Location:await sign(upload.storage_path,expiresIn),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 }
 if(path==='/api/admin/video-uploads'&&request.method==='POST'){
 const input=await request.json();if(!config.mimeTypes.includes(input.mimeType)||!Number.isInteger(input.fileSize)||input.fileSize<=0||input.fileSize>config.maxFileBytes)fail('请选择50MB以内的 MP4 或 WebM 视频');
 const id=crypto.randomUUID(),storage_path='videos/'+id;
 await client.request('/rest/v1/video_uploads',change('POST',{id,owner:user.id,storage_path,mime_type:input.mimeType,file_size:input.fileSize}));
 const d=await client.request('/storage/v1/object/upload/sign/'+bucket+'/'+storage_path,change('POST',{}));
 return Response.json({id,uploadUrl:client.config.url+'/storage/v1'+d.url});
 }
 if(path==='/api/admin/videos'&&request.method==='GET'){const saved=await repo.list('videos');return Response.json([...saved,...examples.filter(v=>!saved.some(s=>s.id===v.id)).map(v=>({...v,revision:0,status:'published'}))],{headers:{'Cache-Control':'private, no-store'}});}
 if(path==='/api/admin/videos'&&['DELETE','PATCH'].includes(request.method)){
 const input=await request.json();if(typeof input.id!=='string'||!Number.isInteger(input.revision)||input.revision<0)fail('缺少视频标识或版本号');
 const existing=await repo.get('videos',input.id);
 if(!existing){const seed=examples.find(v=>v.id===input.id);if(!seed||request.method!=='DELETE'||input.revision!==0)fail('视频不存在',404);return Response.json(await repo.save('videos',{...seed,status:'draft',deletedAt:new Date().toISOString()},0,user.id));}
 return Response.json(await repo.archive('videos',input.id,input.revision,request.method==='PATCH'));
 }
 if(path==='/api/admin/videos'&&request.method==='PUT'){
 const input=await request.json();if(typeof input.id!=='string'||!/^video-[a-z0-9-]+$/.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>180)fail('请填写视频标题');
 if(!Number.isInteger(input.revision)||input.revision<0)fail('视频版本不正确');
 let source=videoSource(input.videoUrl||'');let uploadId='';
 if(input.videoProvider==='selfHosted'){
 const upload=await get(input.uploadId);if(!upload||upload.owner!==user.id)fail('请先上传视频');
 const response=await transport(await sign(upload.storage_path),{headers:{Range:'bytes=0-31'},signal:AbortSignal.timeout(30000)});if(!response.ok)fail('视频上传尚未完成');
 const size=Number(response.headers.get('content-range')?.split('/')[1]||response.headers.get('content-length'));const reader=response.body.getReader();let bytes=new Uint8Array();try{while(bytes.length<12){const next=await reader.read();if(next.done)break;const b=new Uint8Array(bytes.length+next.value.length);b.set(bytes);b.set(next.value,bytes.length);bytes=b}}finally{await reader.cancel()}
 const valid=upload.mime_type==='video/mp4'?String.fromCharCode(...bytes.slice(4,8))==='ftyp':[26,69,223,163].every((n,i)=>bytes[i]===n);
 if(!valid||size!==Number(upload.file_size))fail('视频内容或大小校验失败，请重新上传');
 uploadId=upload.id;source={videoProvider:'selfHosted',videoUrl:'/api/video-files/'+input.id};
 }
 if(!source)fail('请输入有效的 Bilibili BV 视频链接或 YouTube 链接');
 const field=(v,max=2000)=>typeof v==='string'?v.trim().slice(0,max):'';
 const now=new Date().toISOString();const existing=await repo.get('videos',input.id);
 const video={id:input.id,contentType:'video',title:input.title.trim(),description:field(input.description),...source,uploadId,thumbnail:'/charts/btc-range.svg',duration:Math.max(0,Math.min(86400,Number(input.duration)||0)),category:field(input.category,80)||'视频研究',topics:[field(input.category,80)||'市场专题'],chapter:'',courseId:'',tags:Array.isArray(input.tags)?input.tags.filter(t=>typeof t==='string').slice(0,12).map(t=>t.slice(0,30)):[],symbol:field(input.symbol,40).toUpperCase(),market:field(input.market,40)||'跨市场',sector:'',isMemberOnly:input.isMemberOnly===true,publishedAt:existing?.publishedAt||now,updatedAt:now,relatedPosts:[],relatedVideos:[],isExample:false,status:input.status==='draft'?'draft':'published'};
 return Response.json(await repo.save('videos',video,input.revision,user.id));
 }
 fail('视频接口不存在',404);
 }};
}
