import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMutation} from '../server/supabase/request-security.mjs';
import {createApi} from '../server/supabase/api.mjs';
import {opaqueToken} from './helpers/web-session-fixture.mjs';
const memberships={get:async()=>({status:'none',expiresAt:null,revision:0})};
const req=(headers={},body='{}')=>new Request('http://localhost:3100/api/auth/login/',{method:'POST',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100','content-type':'application/json',...headers},body});
test('external Host wins over Next internal URL without accepting cross-site origins',()=>{
 assert.equal(checkMutation(req()).ok,true);
 assert.equal(checkMutation(req({host:'localhost:3100',origin:'http://localhost:3100'})).ok,true);
 assert.equal(checkMutation(req({origin:'https://attacker.test','x-forwarded-host':'attacker.test'})).ok,false);
 assert.equal(checkMutation(req({origin:'null'})).ok,false);
 assert.equal(checkMutation(req({'content-type':'text/plain'})).ok,false);
 assert.equal(checkMutation(req({'content-type':'application/json; charset=utf-8'})).ok,true);
 assert.equal(checkMutation(req({origin:'https://site.test'}),{APP_ORIGIN:'https://site.test'}).ok,true);
 assert.equal(checkMutation(req({host:'preview.vercel.app',origin:'https://preview.vercel.app'}),{VERCEL:'1'}).ok,true);
});
test('password login passes credentials intact and sets HttpOnly cookie; session recognizes admin',async()=>{
 const user={id:'test-admin',email:'owner@example.com',signedIn:true,isAdmin:true};let received;
 const auth={login:async(email,password)=>{received={email,password};return {user,token:opaqueToken,expires:2592000}},identify:async r=>r.headers.get('cookie')==='research_session='+opaqueToken?user:{signedIn:false,isAdmin:false}};
 const api=createApi({memberships,env:{ADMIN_EMAILS:'owner@example.com'},repo:{},auth});
 const r=await api(req({},JSON.stringify({email:user.email,password:' secret password '})));
 assert.equal(r.status,200);assert.deepEqual(received,{email:user.email,password:' secret password '});
 const cookie=r.headers.get('set-cookie');assert.match(cookie,/research_session=[a-f0-9]{64}/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Max-Age=2592000/);assert.doesNotMatch(cookie,/Secure/);
 assert.equal((await r.json()).isAdmin,true);
 const s=await api(new Request('http://localhost:3100/api/session',{headers:{cookie:cookie.split(';')[0]}}));assert.equal((await s.json()).isAdmin,true);
});
