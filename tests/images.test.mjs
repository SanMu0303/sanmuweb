import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {database} from '../scripts/sqlite-adapter.mjs';
import {normalizeImages} from '../server/image-model.mjs';
const base='https://example.test';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
function setup(){const objects=new Map();return {DB:database(),ADMIN_EMAILS:'owner@example.test',objects,IMAGES:{async put(path,bytes){objects.set(path,new Uint8Array(bytes))},async get(path){return objects.has(path)?{body:objects.get(path)}:null},async delete(path){objects.delete(path)}}}}
function req(path,{method='GET',data,bytes,id,admin=true,origin=base,mime='image/png'}={}){const headers={};if(admin){headers['oai-authenticated-user-id']='owner';headers['oai-authenticated-user-email']='owner@example.test'}if(method!=='GET'){headers.Origin=origin;headers['Content-Type']=bytes?mime:'application/json'}if(id)headers['X-Image-Id']=id;return new Request(base+path,{method,headers,body:bytes|| (data?JSON.stringify(data):undefined)})}
async function upload(env,id=crypto.randomUUID()){const r=await worker.fetch(req('/api/admin/images',{method:'POST',bytes:png,id}),env);assert.equal(r.status,200);return r.json()}
const document=images=>({slug:'images-test',title:'Test images',excerpt:'Image lifecycle',category:'趋势观察',tags:[],publishedAt:'2026-09-13',pinned:false,access:'public',readMinutes:1,sections:[{heading:'',text:'Image upload QA'}],status:'published',format:'short',revision:0,images});
test('real binary 1 / 4 / 9 uploads, idempotency, ordered publishing and permanent image protection',async()=>{const env=setup();let images=[];for(let n=1;n<=9;n++){images.push(await upload(env));if([1,4,9].includes(n))assert.equal(env.objects.size,n)}const again=await upload(env,images[0].id);assert.equal(again.storagePath,images[0].storagePath);assert.equal(env.objects.size,9);
 const del=await worker.fetch(req('/api/admin/images/'+images[3].id,{method:'DELETE',data:{}}),env);assert.equal(del.status,200);assert.equal(env.objects.size,8);images.splice(3,1);images.unshift(images.pop());
 const response=await worker.fetch(req('/api/admin/articles',{method:'PUT',data:document(images)}),env);assert.equal(response.status,200,await response.clone().text());const saved=await response.json();assert.deepEqual(saved.images.map(i=>i.id),images.map(i=>i.id));assert.deepEqual(saved.images.map(i=>i.sortOrder),[0,1,2,3,4,5,6,7]);
 const read=await worker.fetch(req(images[0].url,{admin:false}),env);assert.equal(read.status,200);assert.equal((await read.arrayBuffer()).byteLength,png.length);assert.equal((await worker.fetch(req('/api/admin/images/'+images[0].id,{method:'DELETE',data:{}}),env)).status,409);env.DB.sqlite.close();
});
test('failed storage upload retries without losing other images; upload authorization and validation',async()=>{const env=setup();const image=await upload(env);const id=crypto.randomUUID();const put=env.IMAGES.put;env.IMAGES.put=async()=>{throw new Error('simulated storage outage')};assert.equal((await worker.fetch(req('/api/admin/images',{method:'POST',bytes:png,id}),env)).status,503);env.IMAGES.put=put;await upload(env,id);assert.equal(env.objects.size,2);
 assert.equal((await worker.fetch(req('/api/admin/images',{method:'POST',bytes:png,id:crypto.randomUUID(),admin:false}),env)).status,401);
 assert.equal((await worker.fetch(req('/api/admin/images',{method:'POST',bytes:png,id:crypto.randomUUID(),origin:'https://evil.test'}),env)).status,403);
 assert.equal((await worker.fetch(req('/api/admin/images',{method:'POST',bytes:new TextEncoder().encode('<script>bad</script>'),id:crypto.randomUUID()}),env)).status,400);
 assert.equal((await worker.fetch(req(image.url,{admin:false}),env)).status,404);
 assert.equal((await worker.fetch(req('/api/admin/articles',{method:'PUT',data:document(Array(10).fill(image))}),env)).status,400);
 env.DB.sqlite.close();
});
test('member images remain private via the image endpoint; legacy formats normalize',async()=>{const env=setup();const image=await upload(env);const r=await worker.fetch(req('/api/admin/articles',{method:'PUT',data:{...document([image]),access:'member'}}),env);assert.equal(r.status,200);assert.equal((await worker.fetch(req(image.url,{admin:false}),env)).status,404);assert.equal((await worker.fetch(req(image.url),env)).status,200);
 assert.equal(normalizeImages({imageUrl:'/old.png'})[0].thumbnailUrl,'/old.png');assert.equal(normalizeImages({imageUrls:['/a.png','/b.png']}).length,2);env.DB.sqlite.close();
});
test('file and post byte limits, failed publish releases claims, expired temporary objects are cleaned',async()=>{
 const env=setup();const tooLarge=new Uint8Array(15*1024*1024+1);tooLarge.set(png.slice(0,8));assert.equal((await worker.fetch(req('/api/admin/images',{method:'POST',bytes:tooLarge,id:crypto.randomUUID()}),env)).status,413);
 const image=await upload(env);const modified={...image,fileSize:15*1024*1024};await env.DB.prepare('UPDATE image_uploads SET document = ? WHERE id = ?').bind(JSON.stringify(modified),image.id).run();
 assert.equal((await worker.fetch(req('/api/admin/articles',{method:'PUT',data:document(Array(4).fill({...image,fileSize:1}))}),env)).status,400);
 assert.equal((await env.DB.prepare('SELECT state FROM image_uploads WHERE id = ?').bind(image.id).first()).state,'temporary');
 await env.DB.prepare('UPDATE image_uploads SET created_at = ? WHERE id = ?').bind(0,image.id).run();await upload(env);assert(!env.objects.has(image.storagePath));env.DB.sqlite.close();
});
