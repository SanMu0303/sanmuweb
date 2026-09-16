import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/supabase/auth.mjs';
import {createApi} from '../server/supabase/api.mjs';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'test',ADMIN_EMAILS:'owner@example.com'};
const user={id:'reader',email:'reader@example.com',email_confirmed_at:'2026-09-16',user_metadata:{role:'admin'}};
const req=(path,data,origin='https://site.test')=>new Request('https://site.test/api/auth/'+path,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
test('invalid OTP is rejected before transport; expired and reused OTP never sets cookie',async()=>{
 let calls=0;const auth=createAuth(env,async()=>{calls++;return Response.json({code:'otp_expired'},{status:403})});
 await assert.rejects(auth.verifyOtp(user.email,'abc123'),{status:400});assert.equal(calls,0);
 const api=createApi({env,repo:{},auth});const r=await api(req('otp/verify',{email:user.email,code:'123456'}));assert.equal(r.status,400);assert.match((await r.json()).error,/错误或已过期/);assert.equal(r.headers.get('set-cookie'),null);
});
test('OTP session is validated by auth server and stays server-side',async()=>{
 const calls=[];const auth=createAuth(env,async(url,options)=>{calls.push({url,...options});return Response.json(url.endsWith('/verify')?{access_token:'private-token',refresh_token:'private-refresh',expires_in:7200}:user)});
 const api=createApi({env,repo:{},auth});const r=await api(req('otp/verify',{email:' Reader@Example.com ',code:'123456',isAdmin:true}));assert.equal(r.status,200);
 assert.deepEqual(JSON.parse(calls[0].body),{email:user.email,token:'123456',type:'email'});assert.equal(calls[1].headers.Authorization,'Bearer private-token');
 const result=await r.json();assert.equal(result.role,'user');assert.equal(result.isAdmin,false);assert.equal(result.token,undefined);assert.equal(result.refresh_token,undefined);
 assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);
});
test('unconfirmed and mismatched users cannot establish OTP sessions',async()=>{
 for(const invalid of [{...user,email_confirmed_at:null},{...user,email:'another@example.com'}]){const auth=createAuth(env,async url=>Response.json(url.endsWith('/verify')?{access_token:'token'}:invalid));await assert.rejects(auth.verifyOtp(user.email,'123456'),{status:401})}
});
test('send failures and rate limits never report success; cross-origin calls are rejected',async()=>{
 let calls=0;const auth=createAuth(env,async()=>{calls++;return Response.json({code:'over_email_send_rate_limit'},{status:429})});const api=createApi({env,repo:{},auth});
 assert.equal((await api(req('otp/send',{email:user.email},'https://evil.test'))).status,403);assert.equal(calls,0);
 const r=await api(req('otp/send',{email:user.email}));assert.equal(r.status,429);assert.equal((await r.json()).codeSent,undefined);
 for(const path of ['login','register'])assert.equal((await api(req(path,{email:user.email,password:'old-password'}))).status,410);
});
