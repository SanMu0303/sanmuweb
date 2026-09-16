import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/supabase/auth.mjs';
import {createApi} from '../server/supabase/api.mjs';

const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'test',ADMIN_EMAILS:'owner@example.com'};
const user={id:'reader',email:'reader@example.com',email_confirmed_at:'2026-09-16',user_metadata:{role:'admin',isAdmin:true}};
const session={access_token:'private-token',refresh_token:'private-refresh',expires_in:7200};
const password=' a password with spaces ';
const req=(path,data,origin='https://site.test')=>new Request('https://site.test/api/auth/'+path,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
const payload={email:' Reader@Example.com ',password,code:'123456',isAdmin:true,role:'admin',userId:'owner',token:'attacker-token',type:'email',data:{role:'admin'}};
function harness(reply){
 const calls=[],rpcCalls=[];
 const auth=createAuth(env,async(url,options)=>{
  if(url.includes('/rest/v1/rpc/')){rpcCalls.push({url,body:JSON.parse(options.body)});return Response.json({nickname:'交易员1234'})}
  const call={path:url.replace(env.SUPABASE_URL+'/auth/v1',''),method:options.method,headers:options.headers,body:options.body?JSON.parse(options.body):undefined};
  calls.push(call);
  return reply?reply(call,calls):Response.json(call.path==='/verify'||call.path.startsWith('/token?')?session:user);
 });
 return {calls,rpcCalls,auth,api:createApi({env,repo:{},auth})};
}
function assertPrivateBody(body){
 for(const key of ['token','access_token','refresh_token','password','code'])assert.equal(body[key],undefined,key+' must remain private');
}

test('password login uses the password grant, verifies identity, and keeps credentials server-side',async()=>{
 const {api,calls,rpcCalls}=harness();const response=await api(req('login',payload));
 assert.equal(response.status,200);
 assert.deepEqual(calls.map(c=>[c.path,c.method]),[['/token?grant_type=password','POST'],['/user','GET']]);
 assert.deepEqual(calls[0].body,{email:user.email,password});
 assert.equal(calls[1].headers.Authorization,'Bearer private-token');
 assert.deepEqual(rpcCalls.map(c=>c.body),[{p_user_id:user.id}]);
 const body=await response.json();assertPrivateBody(body);assert.equal(body.role,'user');assert.equal(body.isAdmin,false);
 assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);
});

test('historical short passwords still reach login; wrong passwords never establish a session',async()=>{
 const {api,calls}=harness(()=>Response.json({code:'invalid_credentials'},{status:400}));
 const response=await api(req('login',{email:user.email,password:'short'}));
 assert.equal(calls.length,1);assert.equal(calls[0].body.password,'short');assert.equal(response.status,400);
 assert.equal(response.headers.get('set-cookie'),null);assert.match((await response.json()).error,/邮箱或密码/);
});

test('registration send requests a confirmation with email/password and never signs in early',async()=>{
 const {api,calls}=harness(()=>Response.json({id:'unconfirmed',email:user.email}));
 const response=await api(req('register/send',payload));
 assert.equal(response.status,200);assert.deepEqual(calls.map(c=>c.path),['/signup']);
 assert.deepEqual(calls[0].body,{email:user.email,password});
 assert.deepEqual(await response.json(),{codeSent:true,retryAfter:60});assert.equal(response.headers.get('set-cookie'),null);
});

test('accidentally disabled email confirmation cannot bypass registration verification',async()=>{
 const {api}=harness(()=>Response.json(session));const response=await api(req('register/send',payload));
 assert.equal(response.status,503);assert.equal(response.headers.get('set-cookie'),null);assertPrivateBody(await response.json());
});

test('new passwords are checked before signup or consuming any OTP, including the UTF-8 byte limit',async()=>{
 const {auth,calls}=harness();
 for(const invalid of [undefined,null,123,'','1234567','a'.repeat(73),'中'.repeat(25)]){
  for(const run of [()=>auth.sendRegistration(user.email,invalid),()=>auth.register(user.email,invalid,'123456'),()=>auth.resetPassword(user.email,invalid,'123456')]){
   await assert.rejects(run,{status:400});
  }
 }
 assert.equal(calls.length,0);
 await auth.sendRegistration(user.email,'中'.repeat(24));assert.equal(calls[0].body.password,'中'.repeat(24));
});

test('registration verifies signup OTP before applying the mailbox owner password, including spaces',async()=>{
 // A repeated unconfirmed signup may retain someone else's original password upstream.
 let storedPassword='pre-registration-password';
 const {api,calls}=harness(call=>{
  if(call.path==='/verify')return Response.json(session);
  if(call.method==='PUT')storedPassword=call.body.password;
  return Response.json(user);
 });
 const response=await api(req('register',payload));assert.equal(response.status,200);
 assert.deepEqual(calls.map(c=>[c.path,c.method]),[['/verify','POST'],['/user','GET'],['/user','PUT']]);
 assert.deepEqual(calls[0].body,{email:user.email,token:'123456',type:'signup'});
 assert.deepEqual(calls[2].body,{password});assert.equal(calls[2].headers.Authorization,'Bearer private-token');assert.equal(storedPassword,password);
 const body=await response.json();assertPrivateBody(body);assert.equal(body.isAdmin,false);assert.match(response.headers.get('set-cookie'),/HttpOnly/);
});

test('missing sessions and unchecked identities never establish a login or write passwords',async()=>{
 for(const path of ['login','register','password/reset']){
  const missing=harness(()=>Response.json({user}));const noSession=await missing.api(req(path,payload));
  assert.equal(noSession.status,401);assert.equal(noSession.headers.get('set-cookie'),null);assert.equal(missing.calls.length,1);
  for(const invalid of [{...user,id:null},{...user,email_confirmed_at:null},{...user,email:'other@example.com'},{...user,email:null}]){
   const {api,calls}=harness(call=>Response.json(call.path==='/user'?invalid:session));const response=await api(req(path,payload));
   assert.equal(response.status,401);assert.equal(response.headers.get('set-cookie'),null);assert.ok(calls.every(c=>c.method!=='PUT'));
  }
 }
});

test('invalid, expired and reused codes never update passwords or establish sessions',async()=>{
 for(const path of ['register','password/reset']){
  const {api,calls}=harness(()=>Response.json({code:'otp_expired'},{status:403}));
  for(const code of ['abc123','12345','1234567','12345678']){const invalid=await api(req(path,{...payload,code}));assert.equal(invalid.status,400);assert.equal(calls.length,0)}
  for(let attempt=0;attempt<2;attempt++){
   const response=await api(req(path,payload));assert.equal(response.status,400);assert.equal(response.headers.get('set-cookie'),null);assert.match((await response.json()).error,/错误或已过期/);
  }
  assert.ok(calls.every(c=>c.path==='/verify'));assert.equal(calls[0].body.type,path==='register'?'signup':'recovery');
 }
});

test('same_password is accepted only as the exact upstream error after verified identity',async()=>{
 for(const path of ['register','password/reset']){
  const {api,calls}=harness(call=>call.method==='PUT'?Response.json({error_code:'same_password'},{status:422}):Response.json(call.path==='/verify'?session:user));
  const response=await api(req(path,payload));assert.equal(response.status,200);assert.equal(calls[1].method,'GET');assert.equal(calls[2].method,'PUT');
  const unrelated=harness(call=>call.method==='PUT'?Response.json({code:'validation_failed',message:'same_password'},{status:422}):Response.json(call.path==='/verify'?session:user));
  const failure=await unrelated.api(req(path,payload));assert.equal(failure.status,400);assert.equal(failure.headers.get('set-cookie'),null);assert.match((await failure.json()).error,/重新获取验证码/);
 }
});

test('password save failures stay unsuccessful and explain consumed-code recovery',async()=>{
 for(const path of ['register','password/reset']){
  for(const failure of [
   {status:400,reply:()=>Response.json({code:'weak_password'},{status:422})},
   {status:429,reply:()=>Response.json({code:'over_request_rate_limit'},{status:429})},
   {status:503,reply:()=>Response.json({message:'private upstream details'},{status:500})},
   {status:503,reply:()=>{throw new Error('private transport details')}},
  ]){
   const {api,calls}=harness(call=>call.method==='PUT'?failure.reply():Response.json(call.path==='/verify'?session:user));
   const response=await api(req(path,payload));assert.equal(response.status,failure.status);assert.equal(response.headers.get('set-cookie'),null);
   const body=await response.json();assert.match(body.error,/重新获取验证码/);assert.doesNotMatch(body.error,/private/);assert.ok(calls.every(c=>c.path!=='/logout'));
   if(failure.status===503){assert.match(body.error,/新密码登录/);assert.match(body.error,/忘记密码/)}
  }
 }
});

test('recovery requests never create users and give the same response for nonexistent accounts',async()=>{
 const {api,calls}=harness(()=>Response.json({}));const response=await api(req('password/send',payload));
 assert.equal(response.status,200);assert.deepEqual(calls.map(c=>c.path),['/recover']);assert.deepEqual(calls[0].body,{email:user.email});
 assert.deepEqual(await response.json(),{codeSent:true,retryAfter:60});assert.equal(response.headers.get('set-cookie'),null);
});

test('reset uses recovery verification, updates password, retires its session and clears website cookie',async()=>{
 const {api,calls}=harness();const response=await api(req('password/reset',payload));assert.equal(response.status,200);
 assert.deepEqual(calls.map(c=>[c.path,c.method]),[['/verify','POST'],['/user','GET'],['/user','PUT'],['/logout','POST']]);
 assert.deepEqual(calls[0].body,{email:user.email,token:'123456',type:'recovery'});assert.deepEqual(calls[2].body,{password});
 assert.equal(calls[3].headers.Authorization,'Bearer private-token');assert.deepEqual(await response.json(),{passwordReset:true});
 assert.equal(response.headers.get('set-cookie'),'research_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
});

test('send failures and rate limits never report success',async()=>{
 for(const path of ['register/send','password/send']){
  const {api}=harness(()=>Response.json({code:'over_email_send_rate_limit'},{status:429}));const response=await api(req(path,payload));
  assert.equal(response.status,429);assert.equal((await response.json()).codeSent,undefined);assert.equal(response.headers.get('set-cookie'),null);
 }
});

test('every authentication mutation rejects cross-origin requests before contacting auth',async()=>{
 const {api,calls}=harness();
 for(const path of ['login','register/send','register','password/send','password/reset','logout','otp/send','otp/verify']){
  const response=await api(req(path,payload,'https://evil.test'));assert.equal(response.status,403);assert.equal(response.headers.get('set-cookie'),null);
 }
 assert.equal(calls.length,0);
});

test('obsolete OTP-only endpoints remain unavailable and never contact auth',async()=>{
 const {api,calls}=harness();
 for(const path of ['otp/send','otp/verify']){const response=await api(req(path,payload));assert.equal(response.status,410);assert.equal(response.headers.get('set-cookie'),null)}
 assert.equal(calls.length,0);
});
