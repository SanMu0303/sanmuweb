import test from 'node:test';
import assert from 'node:assert/strict';
import {watch} from '../server/content-validation.mjs';
import {createRepository} from '../server/supabase/repository.mjs';
import {createImages} from '../server/supabase/images.mjs';
const document={symbol:'BTC',name:'Bitcoin',market:'加密',stage:'准备',thesis:'观察',invalidation:'失效',updatedAt:'2026-09-15',articleSlug:''};
test('watch image validation preserves order, supports legacy data and rejects invalid URLs and count',()=>{
 assert.deepEqual(watch(document).images,[]);
 assert.equal(watch({...document,images:[{url:'https://example.com/a.png'}]}).images[0].sortOrder,0);
 assert.throws(()=>watch({...document,images:[{url:'javascript:alert(1)'}]}));
 assert.throws(()=>watch({...document,images:Array(10).fill({url:'/a.png'})}));
});
test('watch image saves use authenticated atomic RPC',async()=>{
 let call;const repo=createRepository({request:async(path,options)=>{call={path,body:JSON.parse(options.body)};return {revision:2}}});
 await repo.save('watch_items',{...document,images:[{url:'/api/images/example'}]},1,'admin');
 assert.equal(call.path,'/rest/v1/rpc/save_research_watch');assert.equal(call.body.p_owner,'admin');assert.equal(call.body.p_revision,1);
 await assert.rejects(repo.save('watch_items',{...document,images:[{url:'/api/images/example'}]},1));
});
test('public watch image requires an attached matching image in the current watch document',async()=>{
 const id='00000000-0000-4000-8000-000000000001',storage_path='posts/'+id;
 const image={id,owner:'admin',state:'attached',post_slug:'watch:BTC',storage_path};
 const service=createImages({config:{url:'https://example.supabase.co',bucket:'research-images'},request:async(path)=>path.startsWith('/rest/')?[image]:{signedURL:'/object/sign/research-images/'+storage_path+'?token=test'}});
 const request=new Request('https://site.test/api/images/'+id);
 const repo={get:async(table,key)=>{assert.equal(table,'watch_items');assert.equal(key,'BTC');return {images:[{url:'/api/images/'+id,storagePath:storage_path}]}}};
 assert.equal((await service.handle(request,{isAdmin:false},repo)).status,302);
 await assert.rejects(service.handle(request,{isAdmin:false},{get:async()=>null}),{status:404});
 image.state='temporary';await assert.rejects(service.handle(request,{isAdmin:false},{get:async()=>null}),{status:404});
});
