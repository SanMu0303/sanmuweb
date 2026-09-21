import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {IMAGE_CONFIG} from '../config/images.mjs';

// Run the real client request and upload modules so accidental retries are visible.
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText;
const liveCode=compile('../lib/live.ts'),imageCode=compile('../lib/imageStorage.ts');
const id='00000000-0000-4000-8000-000000000001';
const ticketPath='/api/admin/images/',completePath=ticketPath+id+'/complete/',deletePath=ticketPath+id;
const storageUrl='https://storage.example.test/object/upload/sign/test-image?token=fixture';
const file=Object.freeze({type:'image/png',size:1234});
const image=Object.freeze({id,url:'/api/images/'+id,mimeType:file.type,fileSize:file.size,alt:'研究配图',isPreview:false});
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});

function harness(transport){
 const calls=[],blobs=[],revoked=[];
 const globals={
  async fetch(path,init){const call={path,...init};calls.push(call);return transport(call,calls)},
  AbortSignal,DOMException,Error,TypeError,Promise,setTimeout,clearTimeout,
 };
 const live={};
 runInNewContext(liveCode,{...globals,exports:live,require(name){assert.equal(name,'react');return {}}},{filename:'lib/live.ts'});
 const storage={};
 runInNewContext(imageCode,{
  ...globals,exports:storage,
  require(name){if(name==='./live')return live;assert.equal(name,'@/config/images.mjs');return {IMAGE_CONFIG}},
  URL:{createObjectURL(value){blobs.push(value);return 'blob:test-image'},revokeObjectURL(url){revoked.push(url)}},
  Image:class {naturalWidth=900;naturalHeight=600;set src(_url){queueMicrotask(()=>this.onload())}},
 },{filename:'lib/imageStorage.ts'});
 assert.equal(live.registerReauthentication,undefined);
 return {...storage,calls,blobs,revoked};
}
function ticketPayload(call){
 assert.equal(call.method,'POST');assert.equal(call.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(call.body),{id,mimeType:file.type,fileSize:file.size,width:900,height:600});
 assert.equal(call.cache,'no-store');
}
function storagePayload(call){
 assert.equal(call.method,'PUT');assert.equal(call.headers['Content-Type'],file.type);assert.equal(call.body,file);
}
function successfulTransport(call){
 if(call.path===ticketPath)return response(200,{uploadUrl:storageUrl});
 if(call.path===storageUrl)return response(200,{});
 assert.equal(call.path,completePath);return response(200,image);
}

test('an image is ticketed, uploaded and confirmed once without password verification',async()=>{
 const api=harness(successfulTransport);
 assert.deepEqual(await api.uploadImage(file,id),image);
 assert.deepEqual(api.calls.map(call=>call.path),[ticketPath,storageUrl,completePath]);
 ticketPayload(api.calls[0]);storagePayload(api.calls[1]);
 assert.equal(api.calls[2].method,'POST');assert.equal(api.calls[2].body,'{}');
 assert.deepEqual(api.blobs,[file]);assert.deepEqual(api.revoked,['blob:test-image']);
});

test('a previously completed image is returned without uploading the bytes again',async()=>{
 const api=harness(call=>{assert.equal(call.path,ticketPath);return response(200,{image})});
 assert.deepEqual(await api.uploadImage(file,id),image);
 assert.deepEqual(api.calls.map(call=>call.path),[ticketPath]);
});

test('temporary image deletion submits one unchanged delete request',async()=>{
 const api=harness(call=>{assert.equal(call.path,deletePath);return response(200,{deleted:true})});
 assert.equal(await api.deleteImage(id),undefined);
 assert.equal(api.calls.length,1);
 const [call]=api.calls;
 assert.equal(call.method,'DELETE');assert.equal(call.body,'{}');assert.equal(call.headers['Content-Type'],'application/json');
});

for(const stage of ['ticket','complete','delete'])for(const status of [401,403,428,500])test('image '+stage+' HTTP '+status+' fails once without replay or duplicate bytes',async()=>{
 const failedPath=stage==='ticket'?ticketPath:stage==='complete'?completePath:deletePath;
 const api=harness(call=>call.path===failedPath?response(status,{error:'本次操作失败',code:status===428?'reauthentication_required':'upload_error'}):successfulTransport(call));
 await assert.rejects(stage==='delete'?api.deleteImage(id):api.uploadImage(file,id),error=>error.status===status&&error.message==='本次操作失败');
 assert.equal(api.calls.filter(call=>call.path===failedPath).length,1);
 assert.equal(api.calls.filter(call=>call.path===storageUrl).length,stage==='complete'?1:0);
});

for(const stage of ['ticket','storage','complete'])test('image '+stage+' network failure is never automatically retried',async()=>{
 const failedPath=stage==='ticket'?ticketPath:stage==='storage'?storageUrl:completePath;
 const api=harness(call=>{if(call.path===failedPath)throw new TypeError('offline');return successfulTransport(call)});
 await assert.rejects(api.uploadImage(file,id));
 assert.equal(api.calls.filter(call=>call.path===failedPath).length,1);
 assert.equal(api.calls.filter(call=>call.path===storageUrl).length,stage==='ticket'?0:1);
 assert.equal(api.calls.filter(call=>call.path===completePath).length,stage==='complete'?1:0);
 assert.deepEqual(api.revoked,['blob:test-image']);
});
