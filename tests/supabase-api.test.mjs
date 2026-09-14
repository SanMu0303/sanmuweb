import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/supabase/auth.mjs';
import {createApi} from '../server/supabase/api.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_EMAILS:'owner@example.com'};
test('authentication ignores spoofed platform headers and verifies user with Auth server',async()=>{
 let calls=0;
 const auth=createAuth(env,async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer valid');return Response.json({id:'u',email:'owner@example.com',email_confirmed_at:'2026-09-14'})});
 assert.equal((await auth.identify(new Request('https://site.test',{headers:{'oai-authenticated-user-email':'owner@example.com','oai-authenticated-user-id':'u'}}))).isAdmin,false);
 assert.equal(calls,0);
 assert.equal((await auth.identify(new Request('https://site.test',{headers:{cookie:'research_access=valid'}}))).isAdmin,true);
});
test('API protects writes and projects member content before searching',async()=>{
 const doc={slug:'member',title:'Example',excerpt:'Summary',publishedAt:'2026-09-14',sections:[{text:'public preview',heading:''},{text:'hidden secret',heading:''}],access:'member',status:'published',images:[],tags:[]};
 const repo={list:async()=>[doc],get:async()=>doc,save:async()=>{throw new Error('unauthorized write')}};
 const auth={identify:async()=>({signedIn:false,isAdmin:false})};
 const api=createApi({env,repo,auth});
 const get=await api(new Request('https://site.test/api/feed'));assert.equal(get.status,200);assert.equal(JSON.stringify(await get.json()).includes('hidden secret'),false);
 const search=await api(new Request('https://site.test/api/feed?q=hidden'));assert.deepEqual(await search.json(),[]);
 const write=await api(new Request('https://site.test/api/admin/articles',{method:'PUT',headers:{origin:'https://site.test','Content-Type':'application/json'},body:'{}'}));assert.equal(write.status,401);
 const cross=await api(new Request('https://site.test/api/auth/login',{method:'POST',headers:{origin:'https://other.test','Content-Type':'application/json'},body:'{}'}));assert.equal(cross.status,403);
});
