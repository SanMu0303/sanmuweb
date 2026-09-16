import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/supabase/auth.mjs';
import {createApi} from '../server/supabase/api.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_EMAILS:'owner@example.com'};
test('authentication ignores spoofed platform headers and verifies user with Auth server',async()=>{
 let calls=0;
 const auth=createAuth(env,async(url,options)=>{calls++;if(url.includes('/rest/v1/rpc/')){assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.apikey,'sb_secret_test');return Response.json({nickname:'交易员1234'})}assert.equal(options.headers.Authorization,'Bearer valid');return Response.json({id:'u',email:'owner@example.com',email_confirmed_at:'2026-09-14'})});
 assert.equal((await auth.identify(new Request('https://site.test',{headers:{'oai-authenticated-user-email':'owner@example.com','oai-authenticated-user-id':'u'}}))).isAdmin,false);
 assert.equal(calls,0);
 assert.equal((await auth.identify(new Request('https://site.test',{headers:{cookie:'research_access=valid'}}))).isAdmin,true);
});
test('API protects writes and projects member content before searching',async()=>{
 const doc={slug:'member',title:'Example',excerpt:'Summary',publishedAt:'2026-09-14',sections:[{text:'public preview',heading:''},{text:'hidden secret',heading:''}],access:'member',status:'published',images:[],tags:[]};
 const repo={list:async table=>table==='videos'?[]:[doc],get:async()=>doc,save:async()=>{throw new Error('unauthorized write')}};
 const auth={identify:async()=>({signedIn:false,isAdmin:false})};
 const api=createApi({env,repo,auth});
 const get=await api(new Request('https://site.test/api/feed'));assert.equal(get.status,200);assert.equal(JSON.stringify(await get.json()).includes('hidden secret'),false);
 const search=await api(new Request('https://site.test/api/feed?q=hidden'));assert.deepEqual(await search.json(),[]);
 const write=await api(new Request('https://site.test/api/admin/articles',{method:'PUT',headers:{origin:'https://site.test','Content-Type':'application/json'},body:'{}'}));assert.equal(write.status,401);
 const cross=await api(new Request('https://site.test/api/auth/login',{method:'POST',headers:{origin:'https://other.test','Content-Type':'application/json'},body:'{}'}));assert.equal(cross.status,403);
});
test('delete requires admin and archives with revision while retaining images',async()=>{
 const doc={slug:'record',status:'published',pinned:true,images:[{url:'/api/images/example'}]};let saved;
 const repo={get:async()=>doc,save:async(...args)=>{saved=args;return args[1]}};
 const req=()=>new Request('https://site.test/api/admin/articles',{method:'DELETE',headers:{origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({slug:'record',revision:7})});
 for(const user of [{signedIn:false,isAdmin:false},{signedIn:true,isAdmin:false}]){const api=createApi({env,repo,auth:{identify:async()=>user}});assert.equal((await api(req())).status,user.signedIn?403:401);assert.equal(saved,undefined)}
 const api=createApi({env,repo,auth:{identify:async()=>({id:'owner',signedIn:true,isAdmin:true})}});assert.equal((await api(req())).status,200);assert.equal(saved[1].status,'draft');assert.equal(saved[1].pinned,false);assert.ok(saved[1].deletedAt);assert.deepEqual(saved[1].images,doc.images);assert.equal(saved[2],7);assert.equal(saved[3],'owner');
});
test('sync success returns the persisted watch identity and conflicts do not return success',async()=>{
 const doc={slug:'sync-test',title:'测试',excerpt:'测试',category:'趋势观察',tags:[],publishedAt:'2026-09-15',pinned:false,access:'public',readMinutes:1,sections:[{heading:'',text:'测试'}],status:'published',format:'short',symbol:'APP',market:'美股',trendStage:'准备',watchSync:{enabled:true,revision:3},revision:0};
 let fail=false;const repo={saveWithWatch:async()=>{if(fail)throw Object.assign(new Error('观察池已更新，请刷新后重新同步'),{status:409});return {slug:doc.slug,revision:1}},get:async()=>({symbol:'APP',revision:4,isWeeklyFocus:true})};
 const api=createApi({env,repo,auth:{identify:async()=>({id:'owner',isAdmin:true})}});
 const req=()=>new Request('https://site.test/api/admin/articles',{method:'PUT',headers:{origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(doc)});
 const response=await api(req());assert.equal(response.status,200);assert.deepEqual((await response.json()).watchSyncResult,{symbol:'APP',revision:4,isWeeklyFocus:true});fail=true;assert.equal((await api(req())).status,409);
});
