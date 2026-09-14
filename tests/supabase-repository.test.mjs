import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../server/supabase/repository.mjs';
test('repository pages beyond row caps and preserves database revision',async()=>{
 let calls=0;
 const repo=createRepository({async request(path){calls++;const q=new URL('https://example.test'+path).searchParams;assert.equal(q.get('status'),'eq.published');return q.get('offset')==='0'?Array.from({length:500},(_,i)=>({document:{slug:String(i),revision:99},revision:2})):[{document:{slug:'last'},revision:3}]}});
 const rows=await repo.list('articles',{publishedOnly:true});assert.equal(rows.length,501);assert.equal(rows[0].revision,2);assert.equal(calls,2);
});
test('repository uses atomic revision predicate and fails on stale writes',async()=>{
 let sent;
 const repo=createRepository({async request(path,options){sent={path,options};return []}});
 await assert.rejects(repo.save('articles',{slug:'sample',status:'draft',publishedAt:'2026-09-14',images:[]},3),{status:409});
 assert.equal(new URL('https://example.test'+sent.path).searchParams.get('revision'),'eq.3');
 assert.equal(sent.options.method,'PATCH');
 await assert.rejects(repo.save('articles',{slug:'sample',images:[{url:'/api/images/test'}]},0),/图片关联事务/);
 await assert.rejects(repo.get('arbitrary','sample'),/Unsupported/);
});
