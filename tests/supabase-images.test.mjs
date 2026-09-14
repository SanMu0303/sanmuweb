import test from 'node:test';
import assert from 'node:assert/strict';
import {createImages} from '../server/supabase/images.mjs';
const id='00000000-0000-4000-8000-000000000001';
const user={id:'admin',isAdmin:true};
test('direct upload tickets and completion retain canonical metadata and reject foreign owners',async()=>{
 let record;
 const client={config:{url:'https://example.supabase.co',bucket:'research-images'},async request(path,options){
  if(path.startsWith('/rest/')){if(path.includes('created_at='))return [];if(options?.method==='POST'){record=JSON.parse(options.body);return [record]}if(options?.method==='PATCH'){Object.assign(record,JSON.parse(options.body));return [record]}return record?[record]:[]}
  if(path.includes('/upload/sign/'))return {url:'/object/upload/sign/research-images/posts/'+id+'?token=test'};
  return {signedURL:'/object/sign/research-images/posts/'+id+'?token=test'};
 }};
 const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);
 const service=createImages(client,async()=>new Response(bytes,{status:206,headers:{'content-range':'bytes 0-23/24'}}));
 const post=(path,body={})=>new Request('https://site.test'+path,{method:'POST',body:JSON.stringify(body)});
 const ticket=await service.handle(post('/api/admin/images',{id,mimeType:'image/png',fileSize:24,width:10,height:10}),user,{});
 assert.match((await ticket.json()).uploadUrl,/\/storage\/v1\/object\/upload\/sign\//);
 await assert.rejects(service.handle(post('/api/admin/images/'+id+'/complete'),{id:'other',isAdmin:true},{}),{status:404});
 const completed=await service.handle(post('/api/admin/images/'+id+'/complete'),user,{});assert.equal((await completed.json()).fileSize,24);assert.equal(record.state,'temporary');
 const again=await service.handle(post('/api/admin/images',{id,mimeType:'image/png',fileSize:24}),user,{});assert.ok((await again.json()).image);
});
test('private image download rejects anonymous access before signing',async()=>{
 const client={config:{url:'https://example.supabase.co',bucket:'research-images'},async request(path){assert.ok(path.startsWith('/rest/'));return [{id,owner:'admin',state:'attached',post_slug:'secret',storage_path:'posts/'+id}]}};
 const service=createImages(client);
 await assert.rejects(service.handle(new Request('https://site.test/api/images/'+id),{isAdmin:false},{get:async()=>null}),{status:404});
});
