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

test('watch repository materializes legacy ids and creates new cycles with UUID storage keys',async()=>{
 let request;
 const repo=createRepository({async request(path,options){request={path,options};
  if(path.includes('symbol=eq.LEGACY'))return [{symbol:'LEGACY',document:{symbol:'LEGACY',stage:'准备'},revision:2}];
  if(path.includes('/rpc/save_research_watch'))return {...JSON.parse(options.body).p_document,revision:1};
  return [];
 }});
 const legacy=await repo.get('watch_items','LEGACY');assert.equal(legacy.id,'LEGACY');assert.equal(legacy.symbol,'LEGACY');
 const created=await repo.save('watch_items',{symbol:'LEGACY',name:'Legacy',market:'美股',stage:'准备',thesis:'t',invalidation:'i',updatedAt:'2026-09-19',images:[]},0,'admin');
 assert.match(JSON.parse(request.options.body).p_document.id,/^[0-9a-f-]{20,}$/i);assert.equal(created.revision,1);
});

test('watch sync forwards an explicit cycle id to the transaction RPC',async()=>{
 let body;
 const repo=createRepository({async request(path,options){body=JSON.parse(options.body);return {revision:3,watchSyncResult:{id:'cycle-1'}};}});
 await repo.saveWithWatch({status:'published',format:'short',symbol:'BTC',trendStage:'运行'},2,'admin',{watchId:'cycle-1',revision:2,summary:'判断',invalidation:''});
 assert.equal(body.p_sync.watchId,'cycle-1');
});
