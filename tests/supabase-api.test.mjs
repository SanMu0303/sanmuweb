import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/supabase/auth.mjs';
import {createApi} from '../server/supabase/api.mjs';
import {webSessionFixture} from './helpers/web-session-fixture.mjs';
const memberships={get:async()=>({status:'none',expiresAt:null,revision:0})};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_EMAILS:'owner@example.com'};
test('authentication ignores spoofed platform headers and verifies user with Auth server',async()=>{
 let calls=0;const fixture=webSessionFixture('u');
 const auth=createAuth(env,async(url,options)=>{calls++;if(url.includes('/rest/v1/rpc/')){assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.apikey,'sb_secret_test');return Response.json({nickname:'交易员1234'})}assert.equal(options.headers.Authorization,'Bearer '+fixture.tokens.access_token);return Response.json({id:'u',email:'owner@example.com',email_confirmed_at:'2026-09-14'})},{sessions:fixture.sessions});
 assert.equal((await auth.identify(new Request('https://site.test',{headers:{'oai-authenticated-user-email':'owner@example.com','oai-authenticated-user-id':'u'}}))).isAdmin,false);
 assert.equal(calls,0);
 assert.equal((await auth.identify(new Request('https://site.test',{headers:{cookie:'research_access=valid'}}))).isAdmin,false);assert.equal(calls,0);
 assert.equal((await auth.identify(new Request('https://site.test',{headers:{cookie:fixture.cookie}}))).isAdmin,true);assert.equal(calls,2);
});
test('API protects writes and projects member content before searching',async()=>{
 const doc={slug:'member',title:'Example',excerpt:'Summary',publishedAt:'2026-09-14',sections:[{text:'public preview',heading:''},{text:'hidden secret',heading:''}],access:'member',status:'published',images:[],tags:[]};
 const repo={list:async table=>table==='videos'?[]:[doc],get:async()=>doc,save:async()=>{throw new Error('unauthorized write')}};
 const auth={identify:async()=>({signedIn:false,isAdmin:false})};
 const api=createApi({memberships,env,repo,auth});
 const get=await api(new Request('https://site.test/api/feed'));assert.equal(get.status,200);assert.equal(JSON.stringify(await get.json()).includes('hidden secret'),false);
 const search=await api(new Request('https://site.test/api/feed?q=hidden'));assert.deepEqual(await search.json(),[]);
 const write=await api(new Request('https://site.test/api/admin/articles',{method:'PUT',headers:{origin:'https://site.test','Content-Type':'application/json'},body:'{}'}));assert.equal(write.status,401);
 const cross=await api(new Request('https://site.test/api/auth/login',{method:'POST',headers:{origin:'https://other.test','Content-Type':'application/json'},body:'{}'}));assert.equal(cross.status,403);
});
test('delete requires admin and archives with revision while retaining images',async()=>{
 const doc={slug:'record',status:'published',pinned:true,images:[{url:'/api/images/example'}]};let saved;
 const repo={get:async()=>doc,save:async(...args)=>{saved=args;return args[1]}};
 const req=()=>new Request('https://site.test/api/admin/articles',{method:'DELETE',headers:{origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({slug:'record',revision:7})});
 for(const user of [{signedIn:false,isAdmin:false},{signedIn:true,isAdmin:false}]){const api=createApi({memberships,env,repo,auth:{identify:async()=>user}});assert.equal((await api(req())).status,user.signedIn?403:401);assert.equal(saved,undefined)}
 let rechecked=0;const api=createApi({memberships,env,repo,auth:{identify:async()=>({id:'owner',signedIn:true,isAdmin:true}),requireRecent:async()=>{rechecked++}}});assert.equal((await api(req())).status,200);assert.equal(rechecked,0);assert.equal(saved[1].status,'draft');assert.equal(saved[1].pinned,false);assert.ok(saved[1].deletedAt);assert.deepEqual(saved[1].images,doc.images);assert.equal(saved[2],7);assert.equal(saved[3],'owner');
});
test('sync success returns the persisted watch identity and conflicts do not return success',async()=>{
 const doc={slug:'sync-test',title:'测试',excerpt:'测试',category:'趋势观察',tags:[],publishedAt:'2026-09-15',pinned:false,access:'public',readMinutes:1,sections:[{heading:'',text:'测试'}],status:'published',format:'short',symbol:'APP',market:'美股',trendStage:'准备',watchSync:{enabled:true,revision:3},revision:0};
 let fail=false;const repo={saveWithWatch:async()=>{if(fail)throw Object.assign(new Error('观察池已更新，请刷新后重新同步'),{status:409});return {slug:doc.slug,revision:1}},get:async()=>({symbol:'APP',revision:4,isWeeklyFocus:true})};
 const api=createApi({memberships,env,repo,auth:{identify:async()=>({id:'owner',isAdmin:true}),requireRecent:async()=>{}}});
 const req=()=>new Request('https://site.test/api/admin/articles',{method:'PUT',headers:{origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(doc)});
 const response=await api(req());assert.equal(response.status,200);assert.deepEqual((await response.json()).watchSyncResult,{symbol:'APP',revision:4,isWeeklyFocus:true});fail=true;assert.equal((await api(req())).status,409);
});
test('ending an observation is persistent, idempotent, keeps history, and blocks later writes or sync',async()=>{
 const original={symbol:'CLOSED',name:'Closed observation',market:'跨市场',stage:'运行',thesis:'历史判断',invalidation:'风险条件',createdAt:'2026-09-01T09:00:00.000Z',updatedAt:'2026-09-17',articleSlug:'',images:[],isWeeklyFocus:true,revision:1};
 let current=structuredClone(original),writes=0,syncWrites=0;
 const repo={get:async()=>structuredClone(current),list:async()=>[structuredClone(current)],history:async()=>[{revision:1,document:structuredClone(original)}],save:async(_table,value,revision)=>{writes++;current={...value,revision:revision+1};return structuredClone(current)},saveWithWatch:async()=>{syncWrites++;throw new Error('should not reach synchronized storage')}};
 const auth={identify:async()=>({id:'owner',signedIn:true,isAdmin:true}),requireRecent:async()=>{}};
 const api=createApi({memberships,env,repo,auth});
 const mutation=(method,path='/api/admin/watchlist',data)=>api(new Request('https://site.test'+path,{method,headers:{origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(data)}));
 let response=await mutation('PATCH','/api/admin/watchlist',{action:'end',symbol:'CLOSED',revision:1});assert.equal(response.status,200);const ended=await response.json();assert.equal(ended.observationStatus,'ended');assert.ok(ended.endedAt);assert.equal(ended.isWeeklyFocus,false);assert.equal(ended.thesis,original.thesis);assert.equal(writes,1);
 response=await mutation('PATCH','/api/admin/watchlist',{action:'end',symbol:'CLOSED',revision:2});assert.equal(response.status,200);assert.equal(writes,1,'repeating end must not create a new revision');
 response=await mutation('PUT','/api/admin/watchlist',{...ended,revision:2,thesis:'不能继续更新'});assert.equal(response.status,409);assert.equal(writes,1);
 const syncPost={slug:'closed-sync',title:'closed',excerpt:'closed',category:'趋势观察',tags:[],publishedAt:'2026-09-18',pinned:false,access:'public',readMinutes:1,sections:[{heading:'',text:'new'}],status:'published',format:'short',symbol:'CLOSED',market:'跨市场',trendStage:'运行',images:[],revision:0,watchSync:{enabled:true,revision:2,summary:'new',invalidation:''}};
 response=await mutation('PUT','/api/admin/articles',syncPost);assert.equal(response.status,409);assert.equal(syncWrites,0,'synchronizing a closed observation must not call storage');
 const publicList=await api(new Request('https://site.test/api/watchlist'));assert.equal(publicList.status,200);assert.equal((await publicList.json())[0].observationStatus,'ended');
 current={...original,revision:7,endedAt:'2026-09-18T00:00:00.000Z'};
 response=await mutation('PUT','/api/admin/watchlist',{...current,thesis:'legacy closed write'});assert.equal(response.status,409,'legacy endedAt-only records must remain closed');
});
test('watch detail returns the current observation and complete update history',async()=>{
 const item={symbol:'BTC',name:'比特币',market:'加密',stage:'运行',thesis:'结构仍在延续',invalidation:'跌破低点',createdAt:'2026-09-01T09:00:00.000Z',updatedAt:'2026-09-17',articleSlug:'',observationStatus:'ended',endedAt:'2026-09-18T00:00:00.000Z'};
 const history=[{document:item,revision:2,recorded_at:'2026-09-17T02:00:00.000Z'}];
 const repo={get:async(table,key)=>{assert.equal(table,'watch_items');assert.equal(key,'BTC');return item},history:async symbol=>{assert.equal(symbol,'BTC');return history}};
 const api=createApi({memberships,env,repo,auth:{identify:async()=>({signedIn:false,isAdmin:false})}});
 const response=await api(new Request('https://site.test/api/watchlist/BTC'));
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.item.thesis,item.thesis);assert.equal(body.item.locked,false);assert.equal(body.history[0].document.invalidation,item.invalidation);
});

test('only active cycles block reuse; ended and recycled cycles can start a new one',async()=>{
 const ended={id:'old-cycle',symbol:'BTC',name:'比特币',market:'加密',stage:'运行',thesis:'旧判断',invalidation:'旧条件',createdAt:'2026-09-01T09:00:00.000Z',updatedAt:'2026-09-17',articleSlug:'',images:[],observationStatus:'ended',endedAt:'2026-09-18T00:00:00.000Z',revision:3};
 const active={...ended,id:'active-cycle',observationStatus:'active',endedAt:undefined,revision:4};let records=[ended];let syncCall;let watchCall;
 const repo={list:async()=>records,get:async(_table,key)=>key==='BTC'?records.find(x=>x.symbol==='BTC')||null:records.find(x=>x.id===key)||null,saveWithWatch:async(...args)=>{syncCall=args;return {slug:'new-post',revision:1,watchSyncResult:{id:'new-cycle',symbol:'BTC',revision:1,isWeeklyFocus:false}}},save:async(_table,value)=>{watchCall=value;return {...value,revision:1}}};
 const auth={identify:async()=>({id:'owner',signedIn:true,isAdmin:true}),requireRecent:async()=>{}};const api=createApi({memberships,env,repo,auth});
 const mutate=(path,data)=>api(new Request('https://site.test'+path,{method:'PUT',headers:{origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(data)}));
 const post={slug:'new-btc-cycle',title:'新周期',excerpt:'新周期',category:'趋势观察',tags:[],publishedAt:'2026-09-19',pinned:false,access:'public',readMinutes:1,sections:[{heading:'',text:'重新观察'}],status:'published',format:'short',symbol:'BTC',market:'加密',trendStage:'启动',images:[],revision:0,watchSync:{enabled:true,revision:0}};
 let response=await mutate('/api/admin/articles',post);assert.equal(response.status,200);assert.equal(syncCall[3].watchId,undefined);assert.equal((await response.json()).watchSyncResult.id,'new-cycle');
 const fresh={symbol:'BTC',name:'比特币',market:'加密',stage:'准备',thesis:'新的观察',invalidation:'暂未设置',updatedAt:'2026-09-19',articleSlug:'',images:[],revision:0};response=await mutate('/api/admin/watchlist',fresh);assert.equal(response.status,200);assert.notEqual(watchCall.id,'old-cycle');
 records=[active];response=await mutate('/api/admin/watchlist',{...fresh,revision:0});assert.equal(response.status,409,'an active cycle still prevents duplicate creation');
});
