// Explicit live integration check; only creates/deletes its own UUID test data.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSupabase} from '../server/supabase/client.mjs';
import {createImages} from '../server/supabase/images.mjs';
import {createRepository} from '../server/supabase/repository.mjs';
const client=createSupabase(),service=createImages(client),repo=createRepository(client);
const owner='integration-'+randomUUID(),slug=owner,user={id:owner,isAdmin:true},ids=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64');
const req=(path,method='POST',body={})=>new Request('https://test.invalid'+path,{method,headers:{'Content-Type':'application/json'},...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(body)}:{})});
try{
 const images=[];
 for(let n=0;n<3;n++){
  const id=randomUUID();ids.push(id);const bytes=png;
  const ticket=await (await service.handle(req('/api/admin/images','POST',{id,mimeType:'image/png',fileSize:bytes.length,width:1,height:1}),user,repo)).json();
  const uploaded=await fetch(ticket.uploadUrl,{method:'PUT',headers:{'Content-Type':'image/png'},body:bytes,signal:AbortSignal.timeout(60000)});assert.equal(uploaded.ok,true,'signed upload failed');
  const image=await (await service.handle(req('/api/admin/images/'+id+'/complete'),user,repo)).json();images.push(image);
  if([0,3,8].includes(n))console.log('Uploaded and verified '+(n+1)+' image(s)');
 }
 await service.handle(req('/api/admin/images/'+ids[0],'DELETE'),user,repo);images.shift();console.log('Temporary deletion passed');
 const doc={symbol:slug,name:'Disposable image test',market:'跨市场',stage:'准备',thesis:'Integration fixture',invalidation:'Test only',updatedAt:'2026-09-15',articleSlug:'',images:images.reverse()};
 const saved=await repo.save('watch_items',doc,0,owner);assert.deepEqual(saved.images.map(i=>i.id),images.map(i=>i.id));console.log('Atomic save and ordering passed');
 await assert.rejects(repo.save('watch_items',doc,0,owner),{status:409});
 await assert.rejects(service.handle(req('/api/admin/images/'+images[0].id,'DELETE'),user,repo),{status:409});
 assert.equal((await service.handle(req('/api/images/'+images[0].id,'GET'),{isAdmin:false},repo)).status,302);
 const cleared=await repo.save('watch_items',{...doc,images:[]},saved.revision,owner);
 await assert.rejects(service.handle(req('/api/images/'+images[0].id,'GET'),{isAdmin:false},repo),{status:404});
 await repo.save('watch_items',doc,cleared.revision,owner);
 const view=await service.handle(req('/api/images/'+images[0].id,'GET'),user,repo);assert.equal(view.status,302);const full=await fetch(view.headers.get('location'));assert.equal(full.status,200);await full.body.cancel();
 console.log('Original image access, public access and removal denial, revision and attached-delete protection passed');
}finally{
 await client.request('/rest/v1/watch_items?'+new URLSearchParams({symbol:'eq.'+slug}),{method:'DELETE'});
 if(ids.length)await client.request('/storage/v1/object/'+client.config.bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:ids.map(id=>'posts/'+id)})});
 await client.request('/rest/v1/image_uploads?'+new URLSearchParams({owner:'eq.'+owner}),{method:'DELETE'});
 console.log('Integration fixture cleanup completed');
}
