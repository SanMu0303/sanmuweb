import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/supabase/auth.mjs';
import {createApi} from '../server/supabase/api.mjs';
import {createProfile} from '../server/supabase/profile.mjs';
import {authSession,opaqueToken,webSessionFixture} from './helpers/web-session-fixture.mjs';

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_EMAILS:'owner@example.com'};
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user={id,email:'reader@example.com',email_confirmed_at:'2026-09-16',user_metadata:{nickname:'研究员',role:'admin'}};
const tokens=authSession(id);
const request=()=>new Request('https://site.test',{headers:{cookie:'research_session='+opaqueToken}});
const createTestAuth=(transport,configuration=env)=>createAuth(configuration,transport,{sessions:webSessionFixture(id).sessions});
const authRequest=(path,input)=>new Request('https://site.test/api/auth/'+path,{method:'POST',headers:{origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(input)});

test('canonical persistent nickname wins over mutable Auth metadata and needs a verified user',async()=>{
 const calls=[];let untrustedMetadataName='研究员';
 const auth=createTestAuth(async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/user')){assert.equal(options.headers.Authorization,'Bearer '+tokens.access_token);return Response.json({...user,user_metadata:{nickname:untrustedMetadataName}})}
  assert.ok(url.endsWith('/rest/v1/rpc/ensure_user_nickname'));
  assert.deepEqual(JSON.parse(options.body),{p_user_id:id});
  assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.headers.Authorization,undefined);
  return Response.json({nickname:'交易员3481'});
 });
 assert.equal((await auth.identify(new Request('https://site.test'))).signedIn,false);assert.equal(calls.length,0);
 assert.equal((await auth.identify(request())).nickname,'交易员3481');
 untrustedMetadataName='spoofed-name';assert.equal((await auth.profile(request())).user.nickname,'交易员3481');
 assert.deepEqual(calls.map(c=>c.url.split('/').pop()),['user','ensure_user_nickname','user','ensure_user_nickname']);
});

test('failed Auth verification never reaches service-role nickname RPC',async()=>{
 for(const bad of [{...user,id:null},{...user,email_confirmed_at:null},{...user,email:null}]){
  let calls=0;const auth=createTestAuth(async url=>{calls++;assert.ok(url.endsWith('/user'));return Response.json(bad)});
  assert.equal((await auth.identify(request())).signedIn,false);assert.equal(calls,1);
  await assert.rejects(auth.updateProfile(request(),'昵称'),{status:401});assert.equal(calls,1,'the invalid session was already revoked');
 }
});

test('legacy service-role keys are used only for nickname RPC, never replacing verified Auth bearer',async()=>{
 const legacyEnv={...env,SUPABASE_SECRET_KEY:'legacy-service-jwt'};
 const auth=createTestAuth(async(url,options)=>{
  if(url.endsWith('/user')){assert.equal(options.headers.Authorization,'Bearer '+tokens.access_token);return Response.json(user)}
  assert.equal(options.headers.Authorization,'Bearer legacy-service-jwt');assert.deepEqual(JSON.parse(options.body),{p_user_id:id});
  return Response.json({nickname:'交易员5678'});
 },legacyEnv);
 assert.equal((await auth.identify(request())).nickname,'交易员5678');
});

test('nickname pool exhaustion returns clear 503 without a shared fallback or sign-in cookie',async()=>{
 const auth=createTestAuth(async url=>{
  if(url.includes('/token?'))return Response.json(tokens);
  if(url.endsWith('/user'))return Response.json(user);
  return Response.json({code:'PT503',message:'private database details'},{status:503});
 });
 const api=createApi({env,repo:{},auth});const response=await api(authRequest('login',{email:user.email,password:'password'}));
 assert.equal(response.status,503);assert.equal(response.headers.get('set-cookie'),null);
 assert.deepEqual(await response.json(),{error:'默认昵称号段已满，请联系管理员'});
});

test('unavailable nickname storage never generates an ephemeral fallback',async()=>{
 const auth=createTestAuth(async url=>url.endsWith('/user')?Response.json(user):Response.json({code:'XX000',message:'private details'},{status:500}));
 await assert.rejects(auth.identify(request()),error=>error.status===503&&!error.message.includes('private'));
});

test('profile rename and avatar metadata use one RPC bound to the verified user',async()=>{
 const avatar='avatars/'+id+'/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';let written;
 const auth=createTestAuth(async(url,options)=>{
  if(url.endsWith('/user')){assert.equal(options.method,'GET');return Response.json(user)}
  if(url.endsWith('/ensure_user_nickname'))return Response.json({nickname:'交易员3481'});
  assert.ok(url.endsWith('/set_user_nickname'));written=JSON.parse(options.body);return Response.json({nickname:'三木读者'});
 });
 const saved=await auth.updateProfile(request(),' 三木读者 ',avatar);
 assert.deepEqual(written,{p_user_id:id,p_nickname:'三木读者',p_avatar_path:avatar});
 assert.equal(saved.nickname,'三木读者');assert.equal(saved.role,'user');assert.equal(saved.isAdmin,false);
 assert.match(saved.avatarUrl,/cccccccc-cccc-4ccc-8ccc-cccccccccccc\.jpg$/);
});

test('profile changes reject another user avatar before the profile-write RPC',async()=>{
 const calls=[];const auth=createTestAuth(async url=>{calls.push(url);if(url.endsWith('/user'))return Response.json(user);assert.ok(url.endsWith('/ensure_user_nickname'));return Response.json({nickname:'交易员3481'})});
 await assert.rejects(auth.updateProfile(request(),'新昵称','avatars/'+otherId+'/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg'),{status:400});assert.equal(calls.length,2);assert.equal(calls.some(url=>url.endsWith('/set_user_nickname')),false);
});

test('database nickname conflicts remain 409 and cannot fall back to unprotected Auth metadata',async()=>{
 const calls=[];const auth=createTestAuth(async(url,options)=>{
  calls.push({url,method:options.method});
  return url.endsWith('/user')?Response.json(user):url.endsWith('/ensure_user_nickname')?Response.json({nickname:'交易员3481'}):Response.json({code:'PT409',message:'private details'},{status:409});
 });
 await assert.rejects(auth.updateProfile(request(),'别人已使用的昵称'),error=>error.status===409&&error.message==='该昵称已被使用，请更换昵称');
 assert.deepEqual(calls.map(c=>c.method),['GET','POST','POST']);assert.ok(calls[2].url.endsWith('/set_user_nickname'));
});

test('nickname conflict cleans up only the newly uploaded avatar while retaining the previous avatar',async()=>{
 const calls=[],oldAvatar='avatars/'+id+'/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg';
 const service=createProfile({config:{bucket:'images'},request:async(path,options)=>{calls.push({path,...options});return {}}});
 const auth={profile:async()=>({user:{id},avatarPath:oldAvatar}),updateProfile:async()=>{throw Object.assign(new Error('该昵称已被使用，请更换昵称'),{status:409})}};
 await assert.rejects(service.save(request(),{nickname:'重名',avatarData:'data:image/jpeg;base64,/9j/2Q=='},auth),{status:409});
 assert.equal(calls.length,2);assert.equal(calls[0].method,'POST');assert.equal(calls[1].method,'DELETE');
 const removed=JSON.parse(calls[1].body).prefixes;assert.equal(removed.length,1);assert.ok(removed[0].startsWith('avatars/'+id+'/'));assert.notEqual(removed[0],oldAvatar);assert.ok(calls[0].path.endsWith(removed[0]));
});
