import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/supabase/auth.mjs';
import {createApi} from '../server/supabase/api.mjs';
import {sessionHash,sessionToken,SESSION_SECONDS} from '../server/supabase/web-sessions.mjs';

const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'test',ADMIN_EMAILS:'owner@example.com'};
const id='12345678-1234-4234-8234-123456789012',sid='22345678-1234-4234-8234-123456789012';
const grantSid='32345678-1234-4234-8234-123456789012';
const opaque='a'.repeat(64),hash=sessionHash(opaque);
const user={id,email:'owner@example.com',email_confirmed_at:'2026-09-17',user_metadata:{}};
const instant=Date.parse('2026-09-17T00:00:00Z');
const jwt=(subject=id,sessionId=sid,label='initial')=>'header.'+Buffer.from(JSON.stringify({sub:subject,session_id:sessionId})).toString('base64url')+'.'+label;
const pair=(label='initial')=>({access_token:jwt(id,label==='password'?grantSid:sid,label),refresh_token:'server-refresh-'+label,expires_in:3600});
const req=(path='/api/session',body,token=opaque)=>new Request('https://site.test'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{cookie:'research_session='+token}:{}),...(body===undefined?{}:{origin:'https://site.test','Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});

function fixture({row:initialRow,transport:reply,now=()=>instant}={}){
 let row=initialRow===null?null:{state:'ready',user_id:id,auth_session_id:sid,access_token:jwt(),refresh_token:'server-refresh-initial',access_expires_at:new Date(instant+3600000).toISOString(),reauthenticated_at:new Date(instant).toISOString(),version:1,...initialRow};
 const calls=[],storage=[];
 const sessions={
  async begin(email){storage.push(['begin',email]);return {user_id:id,epoch:3}},
  async create(...args){storage.push(['create',...args])},
  async resolve(...args){storage.push(['resolve',...args]);return row?{...row}:{state:'missing'}},
  async finish(...args){storage.push(['finish',...args]);if(!row)return false;const tokens=args[3];row={...row,state:'ready',access_token:tokens.token,refresh_token:tokens.refreshToken,access_expires_at:tokens.expiresAt,version:row.version+1};return true},
  async release(...args){storage.push(['release',...args]);return true},
  async revoke(...args){storage.push(['revoke',...args]);row=null},
  async revokeAll(...args){storage.push(['revokeAll',...args]);row=null},
  async reauthenticate(...args){storage.push(['reauthenticate',...args]);if(!row)return false;row.reauthenticated_at=new Date(now()).toISOString();return true},
 };
 const auth=createAuth(env,async(url,options)=>{
  const path=url.replace(env.SUPABASE_URL,'');
  const call={path,method:options.method,body:options.body?JSON.parse(options.body):undefined,authorization:options.headers.Authorization};calls.push(call);
  const result=reply?await reply(call,{sessions}):undefined;if(result)return result;
  if(path.startsWith('/rest/'))return Response.json({nickname:'三木'});
  if(path.startsWith('/auth/v1/token?'))return Response.json(pair(path.includes('refresh_token')?'renewed':'password'));
  if(path.startsWith('/auth/v1/logout'))return new Response(null,{status:204});
  return Response.json(user);
 },{sessions,now,pause:async()=>{}});
 const members={get:async()=>({status:'none',expiresAt:null,revision:0}),list:async()=>({users:[],page:1,pageSize:20,total:0}),save:async()=>{throw new Error('A rejected admin write must never reach storage')}};
 return {auth,sessions,calls,storage,members,api:createApi({env,auth,repo:{},memberships:members}),setRow(value){row=value}};
}

test('login issues a 30-day opaque HttpOnly cookie and stores only its hash',async()=>{
 const f=fixture(),response=await f.api(req('/api/auth/login',{email:user.email,password:'valid-password'},''));
 assert.equal(response.status,200);
 const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);
 assert.match(cookies[0],/^research_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
 assert.match(cookies[1],/^research_access=;/);
 const body=await response.json();assert.equal(body.signedIn,true);
 assert.ok(!JSON.stringify(body).includes('server-refresh'));assert.equal(body.token,undefined);
 const stored=f.storage.find(c=>c[0]==='create');
 const cookieToken=cookies[0].split(';')[0].split('=')[1];
 assert.equal(stored[1],sessionHash(cookieToken));assert.notEqual(stored[1],cookieToken);assert.equal(stored[2],id);assert.equal(stored[3],grantSid);assert.equal(stored[5],3);
 assert.equal(f.storage[0][0],'begin');
});

test('epoch conflict cannot establish a late login and retires only its new auth session',async()=>{
 const f=fixture();f.sessions.create=async()=>{throw Object.assign(new Error('revoked'),{status:409})};
 const response=await f.api(req('/api/auth/login',{email:user.email,password:'valid-password'},''));
 assert.equal(response.status,409);assert.equal(response.headers.get('set-cookie'),null);
 assert.equal(f.calls.at(-1).path,'/auth/v1/logout?scope=local');
});

test('legacy and malformed cookies cannot bypass the session database',async()=>{
 const f=fixture();
 for(const cookie of ['research_access=old-jwt','research_session=short','research_session='+opaque+'; research_session='+'b'.repeat(64)]){
  const response=await f.api(new Request('https://site.test/api/session',{headers:{cookie}}));
  assert.equal((await response.json()).signedIn,false);assert.equal(f.storage.length,0);assert.equal(f.calls.length,0);
 }
 assert.equal(sessionToken(req('/api/session',undefined,opaque)),opaque);
});

test('missing or expired server session clears the browser cookie and cannot refresh',async()=>{
 const f=fixture({row:null}),response=await f.api(req());
 assert.equal((await response.json()).signedIn,false);
 assert.match(response.headers.get('set-cookie'),/research_session=;.*Max-Age=0/);
 assert.equal(f.calls.length,0);
});

test('valid requests slide the cookie and resolve identity only once per request',async()=>{
 const f=fixture(),request=req();
 const first=await f.auth.identify(request);const profile=await f.auth.profile(request);
 assert.equal(first.id,profile.user.id);assert.equal(f.storage.filter(c=>c[0]==='resolve').length,1);
 assert.equal(f.calls.filter(c=>c.path==='/auth/v1/user').length,1);
 const response=f.auth.applyCookies(request,Response.json({}));assert.match(response.headers.get('set-cookie'),new RegExp('Max-Age='+SESSION_SECONDS));
});

test('expired access tokens refresh server-side without extending recent-password verification',async()=>{
 const f=fixture({row:{state:'refresh',reauthenticated_at:new Date(instant-900000).toISOString()}});
 const request=req();assert.equal((await f.auth.identify(request)).signedIn,true);
 assert.deepEqual(f.calls.find(c=>c.path.includes('grant_type=refresh_token')).body,{refresh_token:'server-refresh-initial'});
 assert.equal(f.storage.filter(c=>c[0]==='finish').length,1);
 await assert.rejects(f.auth.requireRecent(request),{status:428,code:'reauthentication_required'});
 assert.ok(!f.storage.some(c=>c[0]==='reauthenticate'));
});

test('revocation during refresh cannot recreate a website session',async()=>{
 const f=fixture({row:{state:'refresh'},transport:async(call,{sessions})=>{
  if(call.path.includes('grant_type=refresh_token')){await sessions.revoke(hash);return Response.json(pair('new'))}
 }});
 const response=await f.api(req());assert.equal((await response.json()).signedIn,false);
 assert.equal(f.storage.filter(c=>c[0]==='create').length,0);
 assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
});

test('temporary refresh failures release the lease without deleting or clearing the session',async()=>{
 const f=fixture({row:{state:'refresh'},transport:call=>call.path.includes('grant_type=refresh_token')?Response.json({},{status:503}):undefined});
 const response=await f.api(req());assert.equal(response.status,503);assert.equal(response.headers.get('set-cookie'),null);
 assert.equal(f.storage.filter(c=>c[0]==='release').length,1);assert.ok(!f.storage.some(c=>c[0]==='revoke'));
});

test('invalid refresh tokens revoke the website session without exposing upstream details',async()=>{
 const f=fixture({row:{state:'refresh'},transport:call=>call.path.includes('grant_type=refresh_token')?Response.json({message:'secret upstream details'},{status:400}):undefined});
 const response=await f.api(req()),body=await response.json();assert.equal(body.signedIn,false);assert.ok(!JSON.stringify(body).includes('secret'));assert.equal(f.storage.filter(c=>c[0]==='revoke').length,1);
});

test('refresh waiters consume the winning result without reusing the refresh token',async()=>{
 const f=fixture();let waits=0;
 f.sessions.resolve=async()=>++waits<3?{state:'busy'}:{state:'ready',user_id:id,auth_session_id:sid,access_token:jwt(id,sid,'winner'),reauthenticated_at:new Date(instant).toISOString()};
 assert.equal((await f.auth.identify(req())).signedIn,true);assert.equal(waits,3);
 assert.ok(!f.calls.some(c=>c.path.includes('grant_type=refresh_token')));
});

test('a stuck refresh lease returns a bounded retry error without signing out',async()=>{
 const f=fixture({row:{state:'busy'}}),response=await f.api(req());
 assert.equal(response.status,503);assert.match((await response.json()).error,/续期/);
 assert.equal(f.storage.filter(c=>c[0]==='resolve').length,25);assert.equal(response.headers.get('set-cookie'),null);
});

test('a changed upstream user or auth session never inherits the opaque session identity',async()=>{
 for(const bad of [{...user,id:'different'},{...user,email_confirmed_at:null}]){
  const f=fixture({transport:call=>call.path==='/auth/v1/user'?Response.json(bad):undefined});
  assert.equal((await f.auth.identify(req())).signedIn,false);assert.equal(f.storage.filter(c=>c[0]==='revoke').length,1);
 }
});

test('admin mutation is rejected before storage after 15 minutes; read-only requests remain available',async()=>{
 const f=fixture({row:{reauthenticated_at:new Date(instant-900000).toISOString()}});
 const get=await f.api(req('/api/admin/members'));assert.equal(get.status,200);
 const write=new Request('https://site.test/api/admin/members/'+id,{method:'PUT',headers:{cookie:'research_session='+opaque,origin:'https://site.test','Content-Type':'application/json'},body:'{}'});
 const denied=await f.api(write);assert.equal(denied.status,428);assert.equal((await denied.json()).code,'reauthentication_required');
});

test('reauthentication binds to the current account and never returns password or token data',async()=>{
 const f=fixture({row:{reauthenticated_at:new Date(instant-900000).toISOString()}});
 const response=await f.api(req('/api/auth/reauth',{password:'current-password',email:'attacker@example.com'}));
 assert.deepEqual(await response.json(),{verified:true,reauthenticatedUntil:new Date(instant+900000).toISOString()});
 assert.deepEqual(f.calls.find(c=>c.path.includes('grant_type=password')).body,{email:user.email,password:'current-password'});
 assert.deepEqual(f.storage.find(c=>c[0]==='reauthenticate'),['reauthenticate',hash,id]);
 assert.equal(f.calls.at(-1).path,'/auth/v1/logout?scope=local');
 assert.equal(f.calls.at(-1).authorization,'Bearer '+jwt(id,grantSid,'password'));
 assert.equal((await f.auth.identify(req())).signedIn,true);
 await f.auth.requireRecent(req());
});

test('incorrect passwords do not grant recent verification',async()=>{
 const f=fixture({transport:call=>call.path.includes('grant_type=password')?Response.json({code:'invalid_credentials'},{status:400}):undefined});
 const response=await f.api(req('/api/auth/reauth',{password:'wrong'}));assert.equal(response.status,400);assert.ok(!f.storage.some(c=>c[0]==='reauthenticate'));
});

test('sign-out during reauthentication cannot restore the deleted session',async()=>{
 const f=fixture({transport:async(call,{sessions})=>{if(call.path.includes('grant_type=password')){await sessions.revoke(hash);return Response.json(pair('reauth'))}}});
 const response=await f.api(req('/api/auth/reauth',{password:'current-password'}));assert.equal(response.status,401);assert.ok(!f.storage.some(c=>c[0]==='create'));
});

test('local logout and all-device logout use distinct revocation scopes',async()=>{
 for(const all of [false,true]){
  const f=fixture(),response=await f.api(req(all?'/api/auth/logout-all':'/api/auth/logout',{}));assert.equal(response.status,200);
  assert.ok(f.storage.some(c=>c[0]===(all?'revokeAll':'revoke')));
  assert.equal(f.calls.at(-1).path,'/auth/v1/logout?scope='+(all?'global':'local'));
  assert.match(response.headers.get('set-cookie'),/research_session=;.*Max-Age=0/);
 }
});

test('failed website revocation does not claim logout or clear the cookie',async()=>{
 const f=fixture();f.sessions.revokeAll=async()=>{throw Object.assign(new Error('unavailable'),{status:503})};
 const response=await f.api(req('/api/auth/logout-all',{}));assert.equal(response.status,503);
 assert.ok(!(response.headers.get('set-cookie')||'').includes('research_session=;'));
 assert.ok(!f.calls.some(c=>c.path.startsWith('/auth/v1/logout')));
});

test('expired sessions cannot claim to have signed out other devices',async()=>{
 const f=fixture({row:null});
 const response=await f.api(req('/api/auth/logout-all',{}));
 assert.equal(response.status,401);assert.match((await response.json()).error,/重新登录/);
 assert.ok(!f.storage.some(c=>c[0]==='revokeAll'));
 const local=await f.api(req('/api/auth/logout',{}));assert.equal(local.status,200);
});

test('all new authentication mutations reject foreign origins before resolving any session',async()=>{
 const f=fixture();for(const path of ['reauth','logout-all']){
  const response=await f.api(new Request('https://site.test/api/auth/'+path,{method:'POST',headers:{origin:'https://evil.test','Content-Type':'application/json',cookie:'research_session='+opaque},body:'{}'}));assert.equal(response.status,403);
 }
 assert.equal(f.calls.length,0);assert.equal(f.storage.length,0);
});
