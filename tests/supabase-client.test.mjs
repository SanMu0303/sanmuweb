import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabase,configuration} from '../server/supabase/client.mjs';
test('Supabase credentials remain server-side and are not included in errors',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
 let captured;
 const client=createSupabase(env,async(url,options)=>{captured={url,options};return Response.json({secret:'should not be printed'},{status:403})});
 await assert.rejects(client.request('/rest/v1/articles'),{message:'Supabase 请求失败（403）'});
 assert.equal(captured.options.headers.get('apikey'),'sb_secret_test');
 assert.equal(captured.options.headers.has('Authorization'),false);
 assert.equal(captured.options.redirect,'error');
 await assert.rejects(client.request('//other.example/'));
 assert.throws(()=>configuration({...env,SUPABASE_URL:'http://localhost:54321'}));
});
