import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {IMAGE_CONFIG} from '../config/images.mjs';

// Run both real client modules: mocking request() itself would miss an upload
// accidentally bypassing the shared password-verification handler again.
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
const challenge=()=>response(428,{error:'请再次验证管理员密码',code:'reauthentication_required'});
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const outcome=promise=>promise.then(value=>({value}),error=>({error}));

function harness(transport){
 const calls=[],prompts=[],blobs=[],revoked=[];
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
 live.registerReauthentication(attempt=>prompts.push(attempt));
 return {...storage,calls,prompts,blobs,revoked};
}
function ticketPayload(call){
 assert.equal(call.method,'POST');assert.equal(call.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(call.body),{id,mimeType:file.type,fileSize:file.size,width:900,height:600});
}
function storagePayload(call){
 assert.equal(call.method,'PUT');assert.equal(call.headers['Content-Type'],file.type);assert.equal(call.body,file);
}

test('image ticket waits for administrator verification, then uploads the original file once',async()=>{
 let tickets=0;
 const api=harness(call=>{
  if(call.path===ticketPath)return ++tickets===1?challenge():response(200,{uploadUrl:storageUrl});
  if(call.path===storageUrl)return response(200,{});
  assert.equal(call.path,completePath);return response(200,image);
 });
 const pending=outcome(api.uploadImage(file,id));await nextTurn();
 assert.equal(api.prompts.length,1);
 assert.deepEqual(api.calls.map(call=>call.path),[ticketPath],'no storage write is allowed before verification');
 ticketPayload(api.calls[0]);
 api.prompts[0].complete();
 assert.deepEqual(await pending,{value:image});
 assert.deepEqual(api.calls.map(call=>call.path),[ticketPath,ticketPath,storageUrl,completePath]);
 ticketPayload(api.calls[1]);storagePayload(api.calls[2]);
 assert.equal(api.calls[3].method,'POST');assert.equal(api.calls[3].body,'{}');
 assert.equal(api.prompts.length,1);assert.deepEqual(api.blobs,[file]);assert.deepEqual(api.revoked,['blob:test-image']);
});

test('image completion reauthenticates and retries confirmation without uploading the bytes again',async()=>{
 let completions=0;
 const api=harness(call=>{
  if(call.path===ticketPath)return response(200,{uploadUrl:storageUrl});
  if(call.path===storageUrl)return response(200,{});
  assert.equal(call.path,completePath);return ++completions===1?challenge():response(200,image);
 });
 const pending=outcome(api.uploadImage(file,id));await nextTurn();
 assert.equal(api.prompts.length,1);assert.equal(api.calls.filter(call=>call.path===storageUrl).length,1);
 api.prompts[0].complete();assert.deepEqual(await pending,{value:image});
 assert.deepEqual(api.calls.map(call=>call.path),[ticketPath,storageUrl,completePath,completePath]);
 for(const call of api.calls.filter(call=>call.path===completePath)){assert.equal(call.method,'POST');assert.equal(call.body,'{}')}
});

test('temporary image deletion uses the same verification and preserves the delete request on retry',async()=>{
 const api=harness((call,calls)=>{assert.equal(call.path,deletePath);return calls.length===1?challenge():response(200,{deleted:true})});
 const pending=outcome(api.deleteImage(id));await nextTurn();
 assert.equal(api.prompts.length,1);assert.equal(api.calls.length,1);
 api.prompts[0].complete();assert.deepEqual(await pending,{value:undefined});
 assert.equal(api.calls.length,2);
 for(const call of api.calls){assert.equal(call.path,deletePath);assert.equal(call.method,'DELETE');assert.equal(call.body,'{}');assert.equal(call.headers['Content-Type'],'application/json')}
});

for(const stage of ['ticket','complete','delete'])test('cancelling image '+stage+' verification never continues or replays the operation',async()=>{
 const challengedPath=stage==='ticket'?ticketPath:stage==='complete'?completePath:deletePath;
 const api=harness(call=>{
  if(call.path===challengedPath)return challenge();
  if(call.path===ticketPath)return response(200,{uploadUrl:storageUrl});
  assert.equal(call.path,storageUrl);return response(200,{});
 });
 const pending=outcome(stage==='delete'?api.deleteImage(id):api.uploadImage(file,id));await nextTurn();
 assert.equal(api.prompts.length,1);
 const callCount=api.calls.length;
 api.prompts[0].cancel();api.prompts[0].complete();
 const result=await pending;
 assert.equal(result.error?.code,'reauthentication_cancelled');assert.equal(result.error?.status,428);
 assert.equal(api.calls.length,callCount,'cancelled requests must not replay');
 assert.equal(api.calls.filter(call=>call.path===storageUrl).length,stage==='complete'?1:0);
 assert.equal(api.calls.filter(call=>call.path===challengedPath).length,1);
});
