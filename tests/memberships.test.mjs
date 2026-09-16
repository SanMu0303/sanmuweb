import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberships} from '../server/supabase/memberships.mjs';

const actorId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',targetId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_EMAILS:'owner@example.com'};
const actor={id:actorId,email:'OWNER@example.com',isAdmin:true};
const none={status:'none',expiresAt:null,revision:0};
const expiry=new Date(Date.now()+86400000*30).toISOString();
const active={status:'active',expiresAt:expiry,revision:1};
const row={id:targetId,email:'reader@example.com',nickname:'交易员1234',createdAt:'2026-09-16T08:01:02.123456+00:00',confirmed:true,membership:none};
function harness(reply=()=>Response.json(none),config=env){
 const calls=[];
 const memberships=createMemberships(config,async(url,options)=>{const call={url,...options,body:JSON.parse(options.body)};calls.push(call);return reply(call)});
 return {memberships,calls};
}

test('membership read is a bounded read-only RPC and unrecorded users remain nonmembers',async()=>{
 const {memberships,calls}=harness(()=>Response.json({...none,isAdmin:true,token:'private',raw_user_meta_data:{role:'admin'}}));
 assert.deepEqual(await memberships.get(targetId),none);assert.equal(calls.length,1);
 assert.ok(calls[0].url.endsWith('/rest/v1/rpc/get_user_membership'));assert.deepEqual(calls[0].body,{p_user_id:targetId});
 assert.equal(calls[0].cache,'no-store');assert.equal(calls[0].redirect,'error');assert.equal(calls[0].headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(calls[0].headers.Authorization,undefined);
});

test('membership reads preserve the database-computed active, expired and revoked states',async()=>{
 for(const state of [active,{status:'expired',expiresAt:'2020-01-01T00:00:00Z',revision:2},{status:'revoked',expiresAt:expiry,revision:3},{status:'revoked',expiresAt:null,revision:1}]){
  const {memberships}=harness(()=>Response.json(state));
  assert.deepEqual(await memberships.get(targetId),{...state,expiresAt:state.expiresAt?new Date(state.expiresAt).toISOString():null});
 }
});

test('service failures fail closed without leaking upstream details or credentials',async()=>{
 for(const reply of [
  ()=>Response.json({code:'XX000',message:'private database '+env.SUPABASE_SECRET_KEY},{status:500}),
  ()=>Response.json({message:'private access denied'},{status:403}),
  ()=>new Response('private non-JSON error',{status:502}),
  ()=>{throw new Error('private network '+env.SUPABASE_SECRET_KEY)},
 ]){
  const {memberships}=harness(reply);await assert.rejects(memberships.get(targetId),error=>error.status===503&&!/private|sb_secret/.test(error.message));
 }
});

test('malformed membership responses never produce an access grant',async()=>{
 for(const invalid of [null,{},[],{...active,expiresAt:null},{...active,expiresAt:'infinity'},{...active,revision:0},{...none,expiresAt:expiry},{...none,revision:1},{...active,status:'member'},{...active,revision:1.5}]){
  const {memberships}=harness(()=>Response.json(invalid));await assert.rejects(memberships.get(targetId),{status:503});
 }
});

test('invalid identity inputs never reach the database',async()=>{
 const {memberships,calls}=harness();
 for(const invalid of [null,undefined,1,'','not-a-uuid',targetId+'?admin=true'])await assert.rejects(memberships.get(invalid),{status:400});
 assert.equal(calls.length,0);
});

test('administrator lists use bounded filters and project only permitted user fields',async()=>{
 const {memberships,calls}=harness(()=>Response.json({users:[{...row,isAdmin:true,encrypted_password:'secret',raw_app_meta_data:{role:'admin'},access_token:'secret'}],page:2,pageSize:20,total:23,private:'secret'}));
 const result=await memberships.list({query:' Reader ',page:2,status:'none'});
 assert.deepEqual(calls[0].body,{p_query:'Reader',p_page:2,p_status:'none'});
 assert.deepEqual(result,{users:[{...row,createdAt:'2026-09-16T08:01:02.123Z',isAdmin:false}],page:2,pageSize:20,total:23});
 assert.ok(calls[0].url.endsWith('/list_membership_users'));
});

test('administrator indicators come only from configured admin email addresses',async()=>{
 const {memberships}=harness(()=>Response.json({users:[{...row,email:'Owner@Example.com',isAdmin:false,createdAt:null}],page:1,pageSize:20,total:1}));
 const result=await memberships.list();assert.equal(result.users[0].isAdmin,true);assert.equal(result.users[0].createdAt,null);
});

test('list validation rejects unsafe page sizes, invalid states and excessive queries before RPC',async()=>{
 const {memberships,calls}=harness();
 for(const input of [{page:0},{page:-1},{page:1.5},{page:100001},{page:'1'},{status:'paid'},{status:null},{query:'x'.repeat(101)},{query:42}])await assert.rejects(memberships.list(input),{status:400});
 assert.equal(calls.length,0);
 for(const invalid of [
  {users:Array.from({length:21},()=>row),page:1,pageSize:20,total:21},
  {users:[row],page:1,pageSize:100,total:1},
  {users:[row],page:2,pageSize:20,total:1},
  {users:[{...row,id:'bad'}],page:1,pageSize:20,total:1},
  {users:[{...row,confirmed:'true'}],page:1,pageSize:20,total:1},
 ]){const h=harness(()=>Response.json(invalid));await assert.rejects(h.memberships.list(),{status:503})}
});

test('non-admins and spoofed admin flags cannot write memberships',async()=>{
 const {memberships,calls}=harness();
 for(const invalid of [null,{...actor,isAdmin:false},{...actor,isAdmin:'true'},{...actor,email:'attacker@example.com'},{...actor,email:null}]){
  await assert.rejects(memberships.save(invalid,targetId,{action:'set',expiresAt:expiry,revision:0}),{status:403});
 }
 assert.equal(calls.length,0);
});

test('set requires a finite, future, timezone-qualified ISO date and an explicit revision',async()=>{
 const {memberships,calls}=harness();
 for(const expiresAt of [undefined,null,'','infinity','permanent','2030-01-01','2030-01-01T12:00:00','2030-02-30T12:00:00Z','2030-01-01T24:00:00Z','2000-01-01T00:00:00Z'])await assert.rejects(memberships.save(actor,targetId,{action:'set',expiresAt,revision:0}),{status:400});
 for(const revision of [undefined,null,-1,0.5,'0',2147483647])await assert.rejects(memberships.save(actor,targetId,{action:'set',expiresAt:expiry,revision}),{status:400});
 await assert.rejects(memberships.save(actor,targetId,{action:'grant',expiresAt:expiry,revision:0}),{status:400});assert.equal(calls.length,0);
});

test('set sends only verified actor identity, target, absolute expiry and expected revision',async()=>{
 const {memberships,calls}=harness(()=>Response.json({...active,private:'secret'}));
 const result=await memberships.save(actor,targetId,{action:'set',expiresAt:expiry,revision:0,isAdmin:true,role:'admin',actorId:targetId,days:99999});
 assert.deepEqual(result,active);assert.deepEqual(calls[0].body,{p_actor_id:actorId,p_actor_email:'owner@example.com',p_user_id:targetId,p_action:'set',p_expires_at:expiry,p_revision:0});
 assert.ok(calls[0].url.endsWith('/save_user_membership'));
});

test('revoke ignores supplied expiry and renewals preserve optimistic revision checks',async()=>{
 const revoked={status:'revoked',expiresAt:expiry,revision:2};const {memberships,calls}=harness(()=>Response.json(revoked));
 assert.deepEqual(await memberships.save(actor,targetId,{action:'revoke',expiresAt:'infinity',revision:1}),revoked);assert.equal(calls[0].body.p_expires_at,null);
 const stale=harness(()=>Response.json({code:'PT409',message:'会员信息已更新，请刷新后重试'},{status:409}));
 await assert.rejects(stale.memberships.save(actor,targetId,{action:'set',expiresAt:expiry,revision:0}),error=>error.status===409&&/刷新/.test(error.message));
});

test('unconfirmed targets and DB-time expiry checks return friendly bounded errors',async()=>{
 for(const [code,message,status] of [['PT409','用户不存在或邮箱尚未确认，不能修改会员',409],['PT400','请设置有效的未来到期时间',400],['PT403','管理员身份验证失败，请重新登录',403]]){
  const {memberships}=harness(()=>Response.json({code,message,detail:'private details'},{status}));
  await assert.rejects(memberships.save(actor,targetId,{action:'set',expiresAt:expiry,revision:0}),error=>error.status===status&&error.message===message);
 }
});

test('unexpected save results are not reported as a successful membership update',async()=>{
 for(const response of [{...active,revision:3},{...active,status:'revoked'},{...active,expiresAt:new Date(Date.parse(expiry)+1000).toISOString()}]){
  const {memberships}=harness(()=>Response.json(response));await assert.rejects(memberships.save(actor,targetId,{action:'set',expiresAt:expiry,revision:0}),{status:503});
 }
});

test('legacy server keys use service-role authorization for membership RPC',async()=>{
 const {memberships,calls}=harness(()=>Response.json(none),{...env,SUPABASE_SECRET_KEY:'legacy-service-jwt'});await memberships.get(targetId);
 assert.equal(calls[0].headers.Authorization,'Bearer legacy-service-jwt');
});
