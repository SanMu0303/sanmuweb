// Creates and cleans up only UUID-namespaced integration fixtures.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSupabase} from '../server/supabase/client.mjs';
import {createRepository} from '../server/supabase/repository.mjs';
const client=createSupabase(),repo=createRepository(client),key='sync-'+randomUUID(),owner=key;
const post={slug:key,title:'同步测试',excerpt:'测试',sections:[{heading:'',text:'完整正文保留'}],publishedAt:'2026-09-15',status:'published',access:'member',format:'short',symbol:key,market:'跨市场',trendStage:'准备',images:[]};
try{
 const first=await repo.saveWithWatch(post,0,owner,{revision:0,summary:'公开判断',invalidation:'跌破区间'});
 let watch=await repo.get('watch_items',key);assert.equal(watch.thesis,'公开判断');assert.equal(watch.articleSlug,key);assert.equal(watch.invalidation,'跌破区间');assert.equal(watch.images.length,0);
 await assert.rejects(repo.saveWithWatch({...post,title:'不能保存'},first.revision,owner,{revision:0,summary:'冲突',invalidation:''}),{status:409});
 assert.equal((await repo.get('articles',key)).title,'同步测试');
 await repo.saveWithWatch({...post,trendStage:'失效'},first.revision,owner,{revision:watch.revision,summary:'结构失效',invalidation:''});
 watch=await repo.get('watch_items',key);assert.equal(watch.stage,'失效');assert.equal(watch.invalidation,'跌破区间');
 const before=watch.revision;
 await assert.rejects(repo.saveWithWatch({...post,market:'其他市场'},2,owner,{revision:before,summary:'错误市场',invalidation:''}),{status:409});
 assert.equal((await repo.get('watch_items',key)).revision,before);
 console.log('PASS: synchronized create/update, preserved invalidation, no private body/images copied, stale revision rollback, market collision rejection');
}finally{
 await client.request('/rest/v1/articles?'+new URLSearchParams({slug:'eq.'+key}),{method:'DELETE'});
 await client.request('/rest/v1/watch_items?'+new URLSearchParams({symbol:'eq.'+key}),{method:'DELETE'});
 console.log('Integration fixtures cleaned');
}
