import test from 'node:test';
import assert from 'node:assert/strict';
import {watchSync,watch} from '../server/content-validation.mjs';
import {createRepository} from '../server/supabase/repository.mjs';
const post={status:'published',format:'short',symbol:'BTC',trendStage:'失效',sections:[{text:'**结构失效。** 后续重新观察'}]};
test('sync is opt-in and validates published short record, symbol, stage and revision',()=>{
 assert.equal(watchSync(undefined,post),null);
 assert.equal(watchSync({enabled:false},post),null);
 const sync=watchSync({enabled:true,revision:2},post);assert.equal(sync.summary,'结构失效');assert.equal(sync.invalidation,'');
 for(const value of [{...post,status:'draft'},{...post,symbol:''},{...post,trendStage:null},{...post,format:'long'}])assert.throws(()=>watchSync({enabled:true,revision:0},value));
 assert.throws(()=>watchSync({enabled:true},post));
});
test('explicit summary and invalidation override defaults; focus defaults false',()=>{
 assert.deepEqual(watchSync({enabled:true,revision:0,summary:'公开判断',invalidation:'跌破区间'},post),{revision:0,summary:'公开判断',invalidation:'跌破区间'});
 const input={symbol:'BTC',name:'BTC',market:'加密',stage:'准备',thesis:'判断',invalidation:'条件',updatedAt:'2026-09-15',articleSlug:''};
 assert.equal(watch(input).isWeeklyFocus,false);assert.equal(watch({...input,isWeeklyFocus:true}).isWeeklyFocus,true);
});
test('synchronized writes use a single transaction RPC with both revisions',async()=>{
 let call;const repo=createRepository({request:async(path,options)=>{call={path,body:JSON.parse(options.body)};return {revision:4}}});
 await repo.saveWithWatch(post,3,'admin',{revision:2,summary:'判断',invalidation:''});
 assert.equal(call.path,'/rest/v1/rpc/save_post_with_watch');assert.equal(call.body.p_revision,3);assert.equal(call.body.p_sync.revision,2);assert.equal(call.body.p_owner,'admin');
});
test('weekly focus is explicit and otherwise preserves the existing selection',()=>{
 assert.equal(watchSync({enabled:true,revision:0,weeklyFocus:true},post).weeklyFocus,true);
 assert.equal(Object.hasOwn(watchSync({enabled:true,revision:0},post),'weeklyFocus'),false);
});
test('history is requested independently in descending revision order',async()=>{
 const repo=createRepository({request:async(path)=>{assert.match(path,/watch_history/);assert.match(path,/revision.desc/);assert.match(path,/symbol=eq.BTC/);return [{revision:2,document:{thesis:'新版'}},{revision:1,document:{thesis:'旧版'}}]}});
 assert.equal((await repo.history('BTC')).length,2);
});
