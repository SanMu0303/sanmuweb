import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoCovers} from '../server/supabase/video-covers.mjs';
import {createVideos} from '../server/supabase/videos.mjs';
import {createApi} from '../server/supabase/api.mjs';
import {projectVideo} from '../server/video-model.mjs';

const origin='https://site.test',storage='https://example.supabase.co';
const id='00000000-0000-4000-8000-000000000001',otherId='00000000-0000-4000-8000-000000000002';
const admin={id:'00000000-0000-4000-8000-000000000010',signedIn:true,isAdmin:true};
const other={...admin,id:'00000000-0000-4000-8000-000000000011'};
const guest={signedIn:false,isAdmin:false};
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
const baseRow={id,owner:admin.id,storage_path:'covers/'+id,mime_type:'image/png',file_size:png.length,state:'waiting'};
const input={id:'video-test',title:'封面测试',revision:0,videoUrl:'https://youtu.be/dQw4w9WgXcQ'};
const request=(path,method='GET',data,headers={})=>new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
function fixture({rows=[baseRow],response,documents=[],patch}={}){
 const records=new Map(rows.map(row=>[row.id,{...row}])),calls=[],downloads=[];
 const client={config:{url:storage},async request(path,options={}){
  calls.push({path,...options});const method=options.method||'GET';
  if(path.startsWith('/rest/v1/video_cover_uploads')){
   if(method==='POST'){const value=JSON.parse(options.body);records.set(value.id,value);return [value]}
   const params=new URL(path,storage).searchParams,row=records.get(params.get('id')?.slice(3));
   if(method==='PATCH'){
    if(patch)return patch(row,JSON.parse(options.body));
    if(!row||params.get('owner')!=='eq.'+row.owner||params.get('state')!=='eq.'+row.state)return [];
    Object.assign(row,JSON.parse(options.body));return [row];
   }
   return row?[row]:[];
  }
  if(path.startsWith('/storage/v1/object/upload/sign/'))return {url:path.slice('/storage/v1'.length)+'?token=upload-test'};
  if(path.startsWith('/storage/v1/object/sign/'))return {signedURL:path.slice('/storage/v1'.length)+'?token=download-test'};
  throw new Error('Unexpected request '+method+' '+path);
 }};
 const transport=async(url,options)=>{downloads.push({url,options});return response?response():new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}})};
 const repo={get:async()=>documents[0]||null,list:async()=>documents};
 return {service:createVideoCovers(client,transport),client,transport,records,calls,downloads,repo};
}
test('cover ticket validates format and 5 MiB limit and ignores forged identity/storage/state',async()=>{
 const f=fixture({rows:[]});
 for(const bad of [{mimeType:'image/svg+xml',fileSize:20},{mimeType:'image/png',fileSize:0},{mimeType:'image/png',fileSize:5*1024*1024+1},{mimeType:'image/png',fileSize:2.5},null]){
  await assert.rejects(f.service.handle(request('/api/admin/video-covers','POST',bad),admin,f.repo),{status:400});
 }
 assert.equal(f.calls.length,0);
 const response=await f.service.handle(request('/api/admin/video-covers','POST',{id,owner:other.id,storage_path:'stolen/private',state:'complete',mimeType:'image/png',fileSize:5*1024*1024}),admin,f.repo);
 const ticket=await response.json(),row=f.records.get(ticket.id);assert.notEqual(ticket.id,id);assert.equal(row.owner,admin.id);assert.equal(row.state,'waiting');assert.equal(row.storage_path,'covers/'+ticket.id);
 assert.match(ticket.uploadUrl,/^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\/research-video-covers\/covers\//);
 assert.deepEqual(Object.keys(ticket).sort(),['id','uploadUrl']);
 const signing=f.calls.at(-1);assert.deepEqual(JSON.parse(signing.body),{});assert.notEqual(signing.headers['x-upsert'],'true');
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('all cover admin routes reject nonadmins before any storage access',async()=>{
 for(const user of [guest,{...admin,isAdmin:false}]){
  const f=fixture();for(const [path,method,data] of [['/api/admin/video-covers','POST',{}],['/api/admin/video-covers/'+id+'/complete','POST',{}],['/api/admin/video-covers/'+id,'GET']])await assert.rejects(f.service.handle(request(path,method,data),user,f.repo),{status:user.signedIn?403:401});
  assert.equal(f.calls.length,0);
 }
});
test('completion verifies the entire object and returns only a stable preview URL; repeat is idempotent',async()=>{
 const f=fixture(),path='/api/admin/video-covers/'+id+'/complete';
 const first=await f.service.handle(request(path,'POST',{}),admin,f.repo);
 assert.deepEqual(await first.json(),{id,previewUrl:'/api/admin/video-covers/'+id});assert.equal(f.records.get(id).state,'complete');assert.ok(f.records.get(id).completed_at);
 assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].options.headers?.Range,undefined);assert.equal(f.downloads[0].options.redirect,'error');assert.ok(f.downloads[0].options.signal instanceof AbortSignal);
 assert.equal(JSON.parse(f.calls.find(c=>c.path.startsWith('/storage/')).body).expiresIn,60);
 assert.deepEqual(await(await f.service.handle(request(path,'POST',{}),admin,f.repo)).json(),{id,previewUrl:'/api/admin/video-covers/'+id});assert.equal(f.downloads.length,1);
});
test('foreign and missing uploads cannot be completed or signed',async()=>{
 const f=fixture();for(const [cover,user] of [[id,other],[otherId,admin],['bad-id',admin]])await assert.rejects(f.service.handle(request('/api/admin/video-covers/'+cover+'/complete','POST',{}),user,f.repo),{status:404});
 assert.equal(f.downloads.length,0);assert.equal(f.calls.some(c=>c.path.startsWith('/storage/')),false);
});
test('completion rejects MIME mismatch, fake images, advertised or real size mismatch, and partial responses',async()=>{
 const badResponses=[
  ()=>new Response(png,{headers:{'content-type':'image/jpeg'}}),
  ()=>new Response(new Uint8Array(png.length),{headers:{'content-type':'image/png'}}),
  ()=>new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length+1)}}),
  ()=>new Response(png.slice(0,-1),{headers:{'content-type':'image/png','content-length':String(png.length)}}),
  ()=>new Response(new Uint8Array(png.length+1),{headers:{'content-type':'image/png'}}),
  ()=>new Response(png,{status:206,headers:{'content-type':'image/png','content-range':'bytes 0-67/1000'}}),
  ()=>new Response(null,{status:404})
 ];
 for(const response of badResponses){const f=fixture({response});await assert.rejects(f.service.handle(request('/api/admin/video-covers/'+id+'/complete','POST',{}),admin,f.repo));assert.equal(f.records.get(id).state,'waiting');assert.equal(f.calls.some(c=>c.method==='PATCH'),false)}
});
test('oversized streaming data is cancelled without saving completion',async()=>{
 let cancelled=false;
 const f=fixture({response:()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(png.length+1))},cancel(){cancelled=true}}),{headers:{'content-type':'image/png'}})});
 await assert.rejects(f.service.handle(request('/api/admin/video-covers/'+id+'/complete','POST',{}),admin,f.repo),{status:400});assert.equal(cancelled,true);assert.equal(f.records.get(id).state,'waiting');
});
test('parallel completion tolerates another successful completion but does not accept a lost row',async()=>{
 const successful=fixture({patch:row=>{row.state='complete';return []}});
 assert.equal((await successful.service.handle(request('/api/admin/video-covers/'+id+'/complete','POST',{}),admin,successful.repo)).status,200);
 const lost=fixture({patch:()=>[]});await assert.rejects(lost.service.handle(request('/api/admin/video-covers/'+id+'/complete','POST',{}),admin,lost.repo),{status:409});
});
test('admin preview permits own complete uploads and existing video covers, but not another unattached upload',async()=>{
 const complete={...baseRow,state:'complete'};
 const f=fixture({rows:[complete]});
 for(const method of ['GET','HEAD']){const response=await f.service.handle(request('/api/admin/video-covers/'+id,method),admin,f.repo);assert.equal(response.status,302);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('cache-control'),'private, no-store')}
 await assert.rejects(f.service.handle(request('/api/admin/video-covers/'+id),other,f.repo),{status:404});
 assert.equal((await f.service.handle(request('/api/admin/video-covers/'+id),other,{list:async()=>[{coverUploadId:id,status:'draft'}]})).status,302);
 const waiting=fixture();await assert.rejects(waiting.service.handle(request('/api/admin/video-covers/'+id),admin,waiting.repo),{status:404});
});
test('guests can see published member cover without gaining video source access; drafts and trash never sign',async()=>{
 const document={id:input.id,status:'published',isMemberOnly:true,coverUploadId:id};
 const f=fixture({rows:[{...baseRow,state:'complete'}],documents:[document]});
 for(const method of ['GET','HEAD'])assert.equal((await f.service.handle(request('/api/video-covers/'+input.id,method),guest,f.repo)).status,302);
 for(const hidden of [{...document,status:'draft'},{...document,deletedAt:'2026-09-17'},null]){
  const before=f.calls.length;await assert.rejects(f.service.handle(request('/api/video-covers/'+input.id),guest,{get:async()=>hidden}),{status:404});assert.equal(f.calls.length,before);
 }
 await assert.rejects(createVideos(f.client,f.transport).handle(request('/api/video-files/'+input.id),guest,f.repo),{status:404});
 assert.ok(f.calls.filter(c=>c.path.startsWith('/storage/')).every(c=>JSON.parse(c.body).expiresIn===60));
});
async function save(f,data,existing=null){let saved;const response=await createVideos(f.client,f.transport).handle(request('/api/admin/videos','PUT',{...input,...data}),admin,{get:async()=>existing,save:async(table,video)=>{assert.equal(table,'videos');saved=video;return {...video,revision:1}}});return {saved,response}}
test('video saves accept completed own covers and ignore arbitrary thumbnail URLs',async()=>{
 const f=fixture({rows:[{...baseRow,state:'complete'}]});
 const {saved}=await save(f,{coverUploadId:id,thumbnail:'https://attacker.test/track',coverStoragePath:'stolen/path'});
 assert.equal(saved.coverUploadId,id);assert.equal(saved.thumbnail,'/api/video-covers/'+input.id);assert.equal(saved.coverStoragePath,undefined);
 const publicVideo=projectVideo({...saved,coverStoragePath:'private',uploadId:'private-video',isMemberOnly:true,videoUrl:'private-source'});
 assert.equal(publicVideo.coverUploadId,undefined);assert.equal(publicVideo.coverStoragePath,undefined);assert.equal(publicVideo.uploadId,undefined);assert.equal(publicVideo.videoUrl,'');assert.equal(publicVideo.thumbnail,saved.thumbnail);
});
test('video cover omission preserves an existing association, empty string removes it without physical deletion',async()=>{
 const f=fixture({rows:[{...baseRow,owner:other.id,state:'complete'}]}),existing={...input,coverUploadId:id,thumbnail:'/api/video-covers/'+input.id};
 for(const data of [{},{coverUploadId:id}])assert.equal((await save(f,data,existing)).saved.coverUploadId,id);
 const removed=await save(f,{coverUploadId:'',thumbnail:'https://attacker.test'},existing);assert.equal(removed.saved.coverUploadId,'');assert.equal(removed.saved.thumbnail,'/charts/btc-range.svg');assert.equal(f.calls.some(c=>c.method==='DELETE'),false);assert.equal(f.records.size,1);
 assert.equal((await save(f,{thumbnail:'https://attacker.test'})).saved.thumbnail,'/charts/btc-range.svg');
});
test('new cover associations reject incomplete, foreign, unknown or malformed upload IDs',async()=>{
 for(const row of [baseRow,{...baseRow,state:'complete',owner:other.id}]){
  const f=fixture({rows:[row]});await assert.rejects(save(f,{coverUploadId:id}),{status:400});
 }
 const f=fixture({rows:[]});for(const coverUploadId of [otherId,null,{},'../../secret','not-a-uuid'])await assert.rejects(save(f,{coverUploadId}),{status:400});
});
test('custom categories trim, preserve 80 Unicode characters, reject oversize and allow truly uncategorized videos',async()=>{
 const f=fixture({rows:[]});
 for(const category of ['  自定义复盘  ','📈'.repeat(80),'']){const {saved}=await save(f,{category});assert.equal(saved.category,category.trim());assert.deepEqual(saved.topics,category.trim()?[category.trim()]:[])}
 assert.deepEqual((await save(f,{category:'   '})).saved.topics,[]);
 for(const category of ['自'.repeat(81),'a'.repeat(81),{},123])await assert.rejects(save(f,{category}),{status:400});
});
test('cover APIs inherit admin, recent-password and same-origin guards before any storage calls',async()=>{
 let lookups=0,reauth=0;
 const build=user=>createApi({env:{},repo:{},memberships:{get:async()=>{lookups++;return {status:'none',expiresAt:null,revision:0}}},auth:{identify:async()=>user,requireRecent:async()=>{reauth++;throw Object.assign(new Error('请重新验证密码'),{status:428,code:'reauthentication_required'})}}});
 const paths=[['/api/admin/video-covers','POST'],['/api/admin/video-covers/'+id+'/complete','POST'],['/api/admin/video-covers/'+id,'GET']];
 for(const user of [guest,{...admin,isAdmin:false}])for(const [path,method] of paths)assert.equal((await build(user)(request(path,method,method==='POST'?{}:undefined))).status,user.signedIn?403:401);
 const api=build(admin);for(const [path,method] of paths.filter(p=>p[1]==='POST')){const response=await api(request(path,method,{}));assert.equal(response.status,428);assert.equal((await response.json()).code,'reauthentication_required');assert.equal((await api(request(path,method,{}, {origin:'https://attacker.test'}))).status,403)}
 assert.equal(lookups,0);assert.equal(reauth,2);
});
test('API integrates ticket, completion, save and public cover without exposing registry fields or unlocking playback',async t=>{
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY;
 process.env.SUPABASE_URL=storage;process.env.SUPABASE_SECRET_KEY='sb_secret_cover_unit_test';
 t.after(()=>{if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey});
 const f=fixture({rows:[]}),documents=[];let recent=0;
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  const parsed=new URL(url);assert.equal(parsed.origin,storage);
  if(parsed.searchParams.has('token'))return new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}});
  return Response.json(await f.client.request(parsed.pathname+parsed.search,options));
 });
 const repo={get:async()=>documents[0]||null,list:async()=>documents,save:async(table,video)=>{documents[0]={...video,revision:1};return documents[0]}};
 const build=user=>createApi({env:{},repo,memberships:{get:async()=>({status:'none',expiresAt:null,revision:0})},auth:{identify:async()=>user,requireRecent:async()=>{recent++}}});
 const api=build(admin);
 const ticketResponse=await api(request('/api/admin/video-covers','POST',{mimeType:'image/png',fileSize:png.length}));assert.equal(ticketResponse.status,200);const ticket=await ticketResponse.json();
 const completed=await api(request('/api/admin/video-covers/'+ticket.id+'/complete','POST',{}));assert.equal(completed.status,200);assert.equal((await completed.json()).previewUrl,'/api/admin/video-covers/'+ticket.id);
 assert.equal((await api(request('/api/admin/video-covers/'+ticket.id))).status,302);
 const saved=await api(request('/api/admin/videos','PUT',{...input,coverUploadId:ticket.id,isMemberOnly:false}));assert.equal(saved.status,200);assert.equal(recent,3);
 const publicApi=build(guest),cover=await publicApi(request('/api/video-covers/'+input.id));assert.equal(cover.status,302);assert.match(cover.headers.get('location'),/research-video-covers/);
 const library=await(await publicApi(request('/api/library'))).json();assert.equal(library.videos[0].coverUploadId,undefined);assert.equal(library.videos[0].videoUrl,'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');assert.equal(library.videos[0].locked,false);
 documents[0].deletedAt='2026-09-17T00:00:00Z';assert.equal((await publicApi(request('/api/video-covers/'+input.id))).status,404);
});
