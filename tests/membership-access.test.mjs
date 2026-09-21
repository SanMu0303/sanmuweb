import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../server/supabase/api.mjs';
import {createAuth} from '../server/supabase/auth.mjs';
import {createImages} from '../server/supabase/images.mjs';
import {createVideos} from '../server/supabase/videos.mjs';
import {watchSync} from '../server/content-validation.mjs';
import {opaqueToken,webSessionFixture} from './helpers/web-session-fixture.mjs';

const origin='https://site.test';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_EMAILS:'owner@example.com'};
const readerId='00000000-0000-4000-8000-000000000001';
const ownerId='00000000-0000-4000-8000-000000000002';
const imageId='00000000-0000-4000-8000-000000000003';
const previewId='00000000-0000-4000-8000-000000000004';
const uploadId='00000000-0000-4000-8000-000000000005';
const secret='MEMBER_BODY_SHOULD_NOT_LEAK';
const reader={id:readerId,email:'reader@example.com',signedIn:true,isAdmin:false,role:'user'};
const admin={...reader,id:ownerId,email:'owner@example.com',isAdmin:true,role:'admin'};
const guest={id:null,signedIn:false,isAdmin:false,role:'guest'};
const membership=status=>({status,expiresAt:status==='none'?null:status==='expired'?'2020-01-01T00:00:00.000Z':'2099-01-01T00:00:00.000Z',revision:status==='none'?0:1});
const none=membership('none');
const doc={slug:'member-research',title:'会员研究',excerpt:'公开摘要',publishedAt:'2026-09-16',updatedAt:'2026-09-16T10:00:00.000Z',sections:[{heading:'预览',text:'可公开的预览'},{heading:'会员正文',text:secret}],content:[{text:secret}],access:'member',status:'published',images:[{id:previewId,url:'/api/images/'+previewId,storagePath:'posts/'+previewId,isPreview:true},{id:imageId,url:'/api/images/'+imageId,storagePath:'posts/'+imageId,isPreview:false}],storagePath:'legacy/private/article',tags:[]};
const video={id:'video-member',title:'会员视频',description:'公开视频简介',isMemberOnly:true,status:'published',videoProvider:'selfHosted',videoUrl:'/api/video-files/video-member',uploadId,storagePath:'videos/'+uploadId,publishedAt:doc.publishedAt,updatedAt:doc.updatedAt,tags:[],relatedPosts:[]};
function request(path,method='GET',data,headers={}){return new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})})}
function fixture({user=reader,state=none,repo:overrides={},members:memberOverrides={},auth:authOverrides={}}={}){
 const calls={membership:[],save:[],list:[],get:[],reauth:[]};
 const repo={list:async table=>table==='videos'?[video]:[doc],get:async(table,id,options)=>{calls.get.push({table,id,options});if(table==='videos')return video;return options?.publishedOnly&&doc.status!=='published'?null:doc},...overrides};
 const members={get:async id=>{calls.membership.push(id);return typeof state==='function'?state():state},list:async filters=>{calls.list.push(filters);return {users:[{...reader,membership:state}],total:1,page:1,pageSize:20}},save:async(...args)=>{calls.save.push(args);return membership(args[2].action==='revoke'?'revoked':'active')},...memberOverrides};
 const auth={identify:async()=>user,requireRecent:async r=>{calls.reauth.push(r.url)},...authOverrides};
 return {api:createApi({env,repo,auth,memberships:members}),calls};
}

test('session and profile compute membership from the current server record on every request',async()=>{
 let state=membership('active');
 const {api,calls}=fixture({state:()=>state});
 for(const path of ['/api/session','/api/profile']){const r=await api(request(path));assert.equal(r.status,200);const body=await r.json();assert.equal(body.isMember,true);assert.deepEqual(body.membership,state)}
 state=membership('expired');
 const expired=await(await api(request('/api/session'))).json();assert.equal(expired.isMember,false);assert.equal(expired.membership.status,'expired');
 state=membership('revoked');
 assert.equal((await(await api(request('/api/profile'))).json()).isMember,false);
 assert.deepEqual(calls.membership,[readerId,readerId,readerId,readerId]);
});

test('guests and users without records stay ordinary and cannot spoof membership through identity fields',async()=>{
 const anonymous=fixture({user:{...guest,isMember:true,membership:membership('active')}});
 const guestSession=await(await anonymous.api(request('/api/session'))).json();
 assert.equal(guestSession.isMember,false);assert.equal(guestSession.membership.status,'none');assert.deepEqual(anonymous.calls.membership,[]);
 const ordinary=fixture({user:{...reader,isMember:true,membership:membership('active'),user_metadata:{isMember:true,role:'admin'}}});
 const body=await(await ordinary.api(request('/api/session'))).json();assert.equal(body.isMember,false);assert.equal(body.isAdmin,false);assert.equal(body.membership.status,'none');
});

test('login and registration return database membership rather than client-supplied privilege fields',async()=>{
 for(const endpoint of ['/api/auth/login','/api/auth/register']){
  let supplied;
  const session={user:{...reader,isMember:true,membership:membership('active')},token:opaqueToken,expires:2592000};
  const handler=async(...args)=>{supplied=args;return session};
  const {api,calls}=fixture({auth:{login:handler,register:handler}});
  const response=await api(request(endpoint,'POST',{email:reader.email,password:'chosen-password',code:'123456',isAdmin:true,isMember:true,membership:membership('active')}));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.isMember,false);assert.equal(body.isAdmin,false);assert.equal(body.membership.status,'none');assert.deepEqual(calls.membership,[readerId]);
  assert.equal(supplied[0],reader.email);assert.equal(supplied[1],'chosen-password');assert.equal(JSON.stringify(body).includes(opaqueToken),false);assert.match(response.headers.get('set-cookie'),/research_session=[a-f0-9]{64}/);assert.match(response.headers.get('set-cookie'),/HttpOnly/);
 }
});

test('ordinary, expired, revoked and guest readers receive previews from every article/feed alias',async()=>{
 for(const [user,state] of [[guest,none],[reader,none],[reader,membership('expired')],[reader,membership('revoked')]]){
  const {api}=fixture({user,state});
  for(const path of ['/api/feed','/api/posts','/api/posts/member-research','/api/articles','/api/articles/member-research']){
   const response=await api(request(path));assert.equal(response.status,200,path);const body=await response.json(),serialized=JSON.stringify(body);
   assert.equal(serialized.includes(secret),false,path);assert.equal(serialized.includes('storagePath'),false,path);
   if(!Array.isArray(body)){assert.equal(body.locked,true);assert.equal(serialized.includes('可公开的预览'),true);assert.equal(serialized.includes(imageId),false)}
  }
  const searched=await api(request('/api/feed?q='+secret));assert.deepEqual(await searched.json(),[]);
 }
});

test('active members and admins read full published articles and member videos without storage metadata',async()=>{
 for(const [user,state] of [[reader,membership('active')],[admin,none],[admin,membership('expired')]]){
  const {api}=fixture({user,state});
  for(const path of ['/api/feed','/api/posts','/api/posts/member-research','/api/articles/member-research']){
   const response=await api(request(path));assert.equal(response.status,200,path);const body=await response.json(),serialized=JSON.stringify(body);assert.equal(serialized.includes(secret),true,path);assert.equal(serialized.includes('storagePath'),false,path);
   if(!Array.isArray(body))assert.equal(body.locked,false);
  }
  const library=await(await api(request('/api/library'))).json();assert.equal(library.videos[0].locked,false);assert.equal(library.videos[0].videoUrl,video.videoUrl);assert.equal('storagePath' in library.videos[0],false);assert.equal('uploadId' in library.videos[0],false);
 }
});

test('locked library and feed videos never include their playback URL or upload metadata',async()=>{
 for(const state of [none,membership('expired'),membership('revoked')]){
  const {api}=fixture({state});
  for(const path of ['/api/library','/api/feed']){
   const response=await api(request(path));const data=await response.json();const projected=path==='/api/library'?data.videos[0]:data.find(p=>p.id===video.id).video;
   assert.equal(projected.locked,true);assert.equal(projected.videoUrl,'');assert.equal('uploadId' in projected,false);assert.equal('storagePath' in projected,false);
  }
 }
});

test('automatic short-post excerpts and searches cannot bypass the same preview limit as the body',async()=>{
 const publicPreview='预'.repeat(320),short={...doc,format:'short',sections:[{heading:'',text:publicPreview+secret}],excerpt:publicPreview+secret};
 for(const [user,state] of [[guest,none],[reader,membership('expired')]]){
  const {api}=fixture({user,state,repo:{list:async table=>table==='videos'?[]:[short],get:async()=>short}});
  for(const path of ['/api/feed','/api/posts','/api/posts/member-research','/api/articles','/api/articles/member-research']){const response=await api(request(path));assert.equal(response.status,200);assert.equal((await response.text()).includes(secret),false,path)}
  assert.deepEqual(await(await api(request('/api/feed?q='+secret))).json(),[]);
 }
 const active=fixture({state:membership('active'),repo:{get:async()=>short}});
 assert.equal((await(await active.api(request('/api/posts/member-research'))).text()).includes(secret),true);
});

test('preview access level keeps an explicit safe summary while gating the full short post',async()=>{
 const preview={...doc,access:'preview',format:'short',preview:'公开摘要，不包含执行条件',excerpt:'公开摘要，不包含执行条件',sections:[{heading:'',text:'执行价格 PRIVATE_PREVIEW_BODY'}]};
 const anonymous=fixture({user:guest,state:none,repo:{list:async table=>table==='videos'?[]:[preview],get:async()=>preview}});
 const body=await (await anonymous.api(request('/api/posts/member-research'))).json();
 assert.ok(['preview','member_required'].includes(body.access));assert.equal(body.locked,true);assert.equal(body.content[0].text,'公开摘要，不包含执行条件');assert.equal(JSON.stringify(body).includes('PRIVATE_PREVIEW_BODY'),false);
 const active=fixture({state:membership('active'),repo:{get:async()=>preview}});
 const full=await (await active.api(request('/api/posts/member-research'))).json();assert.equal(full.access,'preview');assert.equal(full.locked,false);assert.equal(JSON.stringify(full).includes('PRIVATE_PREVIEW_BODY'),true);
});

test('automatic member watch summaries stop at the public preview boundary while explicit public summaries remain supported',()=>{
 const value={...doc,status:'published',format:'short',symbol:'BTC',trendStage:'准备',sections:[{heading:'',text:'预'.repeat(320)+secret}]};
 const generated=watchSync({enabled:true,revision:0},value);assert.equal(generated.summary.length,320);assert.equal(generated.summary.includes(secret),false);
 const explicit=watchSync({enabled:true,revision:0,summary:'由管理员填写的公开判断'},value);assert.equal(explicit.summary,'由管理员填写的公开判断');
});

test('membership does not grant access to drafts or any admin route',async()=>{
 const draft={...doc,status:'draft'};
 const {api}=fixture({state:membership('active'),repo:{get:async(table,id,options)=>options?.publishedOnly?null:draft}});
 for(const path of ['/api/posts/private-draft','/api/articles/private-draft'])assert.equal((await api(request(path))).status,404);
 for(const [path,method,data] of [['/api/admin/members','GET'],['/api/admin/articles','GET'],['/api/admin/videos','GET'],['/api/admin/watchlist','PUT',{}],['/api/admin/video-uploads','POST',{}],['/api/admin/images','POST',{}],['/api/admin/members/'+readerId,'PUT',{action:'set',expiresAt:'2099-01-01T00:00:00.000Z',revision:0}]])assert.equal((await api(request(path,method,data))).status,403,path);
 const owner=fixture({user:admin,repo:{get:async(table,id,options)=>options?.publishedOnly?null:draft}});
 const response=await owner.api(request('/api/posts/private-draft'));assert.equal(response.status,200);assert.equal((await response.json()).locked,false);
});

test('member administration requires an authenticated admin and records the trusted actor',async()=>{
 for(const user of [guest,reader]){
  const {api,calls}=fixture({user});
  for(const [path,method,data] of [['/api/admin/members','GET'],['/api/admin/members/'+readerId,'PUT',{action:'revoke',revision:1}]])assert.equal((await api(request(path,method,data))).status,user.signedIn?403:401);
  assert.equal(calls.list.length,0);assert.equal(calls.save.length,0);
  assert.equal(calls.reauth.length,0);
 }
 const {api,calls}=fixture({user:admin});
 const list=await api(request('/api/admin/members?q=reader%40example.com&page=2&status=expired'));assert.equal(list.status,200);assert.equal(calls.list.length,1);assert.equal(calls.list[0].query,'reader@example.com');assert.equal(Number(calls.list[0].page),2);assert.equal(calls.list[0].status,'expired');
 const data={action:'set',expiresAt:'2099-01-01T00:00:00.000Z',revision:4,actor:'forged-id',userId:ownerId};
 const changed=await api(request('/api/admin/members/'+readerId,'PUT',data));assert.equal(changed.status,200);assert.equal((await changed.json()).status,'active');assert.equal(calls.save.length,1);assert.equal(calls.save[0][0]?.id||calls.save[0][0],ownerId);assert.equal(calls.save[0][1],readerId);
 const revoked=await api(request('/api/admin/members/'+readerId,'PUT',{action:'revoke',revision:5}));assert.equal(revoked.status,200);assert.equal((await revoked.json()).status,'revoked');
 assert.equal(calls.reauth.length,0);
});

test('member mutations reject cross-origin and non-JSON requests before calling the service',async()=>{
 const {api,calls}=fixture({user:admin});
 for(const headers of [{origin:'https://attacker.test'},{origin:'null'},{'content-type':'text/plain'}])assert.equal((await api(request('/api/admin/members/'+readerId,'PUT',{action:'revoke',revision:1},headers))).status,403);
 assert.equal(calls.save.length,0);assert.equal(calls.membership.length,0);
 assert.equal(calls.reauth.length,0);
});

test('membership service errors fail closed and expose revision conflicts without success responses',async()=>{
 const unavailable=fixture({members:{get:async()=>{throw new Error('private database diagnostic')}}});
 for(const path of ['/api/session','/api/posts/member-research']){const response=await unavailable.api(request(path));assert.equal(response.status,503);const body=await response.text();assert.equal(body.includes(secret),false);assert.equal(body.includes('private database diagnostic'),false)}
 const conflicting=fixture({user:admin,members:{save:async()=>{throw Object.assign(new Error('会员已被其他管理员修改，请刷新后重试'),{status:409})}}});
 const response=await conflicting.api(request('/api/admin/members/'+readerId,'PUT',{action:'revoke',revision:1}));assert.equal(response.status,409);assert.match((await response.json()).error,/刷新/);
});

test('Auth user metadata cannot assert admin or membership privilege',async()=>{
 const sessions=webSessionFixture(readerId);
 const auth=createAuth(env,async url=>Response.json(url.includes('/rest/v1/rpc/')?{nickname:'交易员1234'}:{...reader,email_confirmed_at:'2026-09-16',user_metadata:{isAdmin:true,isMember:true,role:'admin',membership:membership('active')}}),{sessions:sessions.sessions});
 const result=await auth.identify(request('/api/session','GET',undefined,{cookie:sessions.cookie}));
 assert.equal(result.isAdmin,false);assert.notEqual(result.isMember,true);assert.equal(result.role,'user');
});

test('member images require current content access before any signed URL is issued',async()=>{
 let signed=0;let image={id:imageId,owner:ownerId,state:'attached',post_slug:doc.slug,storage_path:'posts/'+imageId};
 let article=doc;
 const service=createImages({config:{url:'https://example.supabase.co',bucket:'research-images'},request:async(path,options)=>{if(path.startsWith('/rest/'))return [image];signed++;assert.equal(JSON.parse(options.body).expiresIn,60);return {signedURL:'/object/sign/research-images/'+image.storage_path+'?token=short-lived'}}});
 const repo={get:async(table,id,options)=>options?.publishedOnly&&article.status!=='published'?null:article};
 for(const user of [guest,reader,{...reader,isMember:false}]){await assert.rejects(service.handle(request('/api/images/'+imageId),user,repo),{status:404});assert.equal(signed,0)}
 for(const user of [{...reader,isMember:true,membership:membership('active')},admin]){const response=await service.handle(request('/api/images/'+imageId),user,repo);assert.equal(response.status,302);assert.match(response.headers.get('location'),/token=short-lived/);assert.equal(response.headers.get('cache-control'),'private, no-store')}
 article={...doc,status:'draft'};const previous=signed;await assert.rejects(service.handle(request('/api/images/'+imageId),{...reader,isMember:true,membership:membership('active')},repo),{status:404});assert.equal(signed,previous);
 article=doc;image={...image,id:previewId,storage_path:'posts/'+previewId};await assert.rejects(service.handle(request('/api/images/'+previewId),guest,repo),{status:404});assert.equal(signed,previous);
 image={...image,state:'temporary'};await assert.rejects(service.handle(request('/api/images/'+previewId),{...reader,isMember:true,membership:membership('active')},{get:async()=>null}),{status:404});
});

test('direct member video routes gate GET and HEAD before querying or signing private storage',async()=>{
 let lookups=0,signed=0,current=video;
 const service=createVideos({config:{url:'https://example.supabase.co'},request:async(path,options)=>{if(path.startsWith('/rest/')){lookups++;return [{id:uploadId,storage_path:'videos/'+uploadId}]}signed++;assert.ok(JSON.parse(options.body).expiresIn<=(current.isMemberOnly?60:3600));return {signedURL:'/object/sign/research-videos/videos/'+uploadId+'?token=limited'}}});
 const repo={get:async()=>current};
 for(const method of ['GET','HEAD'])for(const user of [guest,reader,{...reader,isMember:false}]){await assert.rejects(service.handle(request('/api/video-files/'+video.id,method),user,repo),{status:404});assert.equal(lookups,0);assert.equal(signed,0)}
 for(const method of ['GET','HEAD'])for(const user of [{...reader,isMember:true,membership:membership('active')},admin]){const response=await service.handle(request('/api/video-files/'+video.id,method),user,repo);assert.equal(response.status,302);assert.match(response.headers.get('location'),/token=limited/);assert.equal(response.headers.get('cache-control'),'private, no-store')}
 const previous=signed;
 for(const hidden of [{...video,status:'draft'},{...video,deletedAt:'2026-09-16T00:00:00.000Z'}]){current=hidden;await assert.rejects(service.handle(request('/api/video-files/'+video.id),{...reader,isMember:true,membership:membership('active')},repo),{status:404})}assert.equal(signed,previous);
 current={...video,isMemberOnly:false};assert.equal((await service.handle(request('/api/video-files/'+video.id),guest,repo)).status,302);
});

test('private asset signatures cannot outlive membership and stale or incomplete access flags fail closed',async t=>{
 const now=Date.parse('2026-09-16T12:00:00.000Z');t.mock.method(Date,'now',()=>now);
 const signed=[];
 const imageService=createImages({config:{url:'https://example.supabase.co',bucket:'research-images'},request:async(path,options)=>{
  if(path.startsWith('/rest/'))return [{id:imageId,owner:ownerId,state:'attached',post_slug:doc.slug,storage_path:'posts/'+imageId}];
  signed.push(JSON.parse(options.body).expiresIn);return {signedURL:'/object/sign/research-images/posts/'+imageId+'?token=short'};
 }});
 const videoService=createVideos({config:{url:'https://example.supabase.co'},request:async(path,options)=>{
  if(path.startsWith('/rest/'))return [{id:uploadId,storage_path:'videos/'+uploadId}];
  signed.push(JSON.parse(options.body).expiresIn);return {signedURL:'/object/sign/research-videos/videos/'+uploadId+'?token=short'};
 }});
 const handlers=[()=>({service:imageService,path:'/api/images/'+imageId,repo:{get:async()=>doc}}),()=>({service:videoService,path:'/api/video-files/'+video.id,repo:{get:async()=>video}})];
 const almostExpired={...reader,isMember:true,membership:{...membership('active'),expiresAt:new Date(now+10_500).toISOString()}};
 for(const build of handlers){const {service,path,repo}=build();assert.equal((await service.handle(request(path),almostExpired,repo)).status,302)}
 assert.deepEqual(signed,[10,10]);
 for(const bad of [{...reader,isMember:true},{...reader,isMember:true,membership:{...membership('active'),expiresAt:null}},{...reader,isMember:true,membership:{...membership('active'),expiresAt:new Date(now).toISOString()}},{...reader,isMember:true,membership:membership('revoked')},{...guest,isMember:true,membership:membership('active')}]){
  for(const build of handlers){const {service,path,repo}=build();await assert.rejects(service.handle(request(path),bad,repo),{status:404})}
 }
 assert.deepEqual(signed,[10,10]);
});
