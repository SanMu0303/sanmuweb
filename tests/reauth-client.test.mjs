import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Execute the actual browser request helper without a network connection.
const clientCode=ts.transpileModule(readFileSync(new URL('../lib/live.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText;
function response(status,data){return {status,ok:status>=200&&status<300,json:async()=>data}}
function harness(transport){
 const exports={},calls=[];
 runInNewContext(clientCode,{
  exports,
  require(name){assert.equal(name,'react');return {}},
  async fetch(path,init){const call={path,...init};calls.push(call);return transport(call,calls)},
  AbortSignal,DOMException,Error,TypeError,Promise,setTimeout,clearTimeout,
 },{filename:'lib/live.ts'});
 return {...exports,calls};
}
function assertPayload(calls,path,init,count=1){
 const matching=calls.filter(call=>call.path===path);
 assert.equal(matching.length,count,'unexpected fetch count for '+path);
 for(const call of matching){assert.equal(call.method,init.method);assert.equal(call.body,init.body);assert.deepEqual(call.headers,init.headers);assert.equal(call.cache,'no-store');assert.ok(call.signal instanceof AbortSignal)}
}
const write={method:'PUT',headers:{'Content-Type':'application/json','X-Test':'original-request'},body:JSON.stringify({title:'尚未保存的研究正文',revision:7})};

test('administrator writes submit directly once without a password-verification UI',async()=>{
 const api=harness(()=>response(200,{saved:true}));
 assert.equal(api.registerReauthentication,undefined);
 assert.doesNotMatch(readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8'),/Reauthentication/);
 assert.deepEqual(await Promise.all([api.request('/api/admin/articles',write),api.request('/api/admin/watchlist',write)]),[{saved:true},{saved:true}]);
 assertPayload(api.calls,'/api/admin/articles',write);
 assertPayload(api.calls,'/api/admin/watchlist',write);
});

test('explicit abort signal and original payload are preserved, with no cached response',async()=>{
 const controller=new AbortController(),api=harness(()=>response(200,{saved:true}));
 await api.request('/api/admin/articles',{...write,signal:controller.signal,cache:'force-cache'});
 assertPayload(api.calls,'/api/admin/articles',write);
 assert.equal(api.calls[0].signal,controller.signal);
});

for(const status of [401,403,428,500])test('HTTP '+status+' surfaces its error and never replays an administrator write',async()=>{
 const api=harness(()=>response(status,{error:'原请求失败',code:status===428?'reauthentication_required':'test_error'}));
 await assert.rejects(api.request('/api/admin/articles',write),error=>error.status===status&&error.message==='原请求失败');
 assertPayload(api.calls,'/api/admin/articles',write);
});

test('an expired session keeps a clear login error without automatically retrying',async()=>{
 const api=harness(()=>response(401,{}));
 await assert.rejects(api.request('/api/admin/articles',write),error=>error.status===401&&/登录已过期/.test(error.message));
 assertPayload(api.calls,'/api/admin/articles',write);
});

test('a network failure does not replay a write and warns that its result is unknown',async()=>{
 const api=harness(()=>{throw new TypeError('offline')});
 await assert.rejects(api.request('/api/admin/articles',write),/网络连接中断，保存结果尚未确认/);
 assertPayload(api.calls,'/api/admin/articles',write);
});

for(const errorName of ['TimeoutError','AbortError'])test(errorName+' preserves the membership unknown-result warning and never replays',async()=>{
 const api=harness(()=>{throw new DOMException('timed out',errorName)});
 await assert.rejects(api.request('/api/admin/members/test-user',write),/保存结果尚未确认，请刷新会员列表核对/);
 assertPayload(api.calls,'/api/admin/members/test-user',write);
});

test('an invalid JSON response warns about a potentially completed save and does not replay',async()=>{
 const api=harness(()=>({status:200,ok:true,json:async()=>{throw new SyntaxError('invalid JSON')}}));
 await assert.rejects(api.request('/api/admin/articles',write),/请先检查内容是否已保存/);
 assertPayload(api.calls,'/api/admin/articles',write);
});

test('read requests report an unexpected challenge without opening a password UI or replaying',async()=>{
 const api=harness(()=>response(428,{error:'其他前置条件',code:'another_requirement'}));
 await assert.rejects(api.request('/api/admin/articles'),error=>error.status===428&&error.code==='another_requirement');
 assert.equal(api.calls.length,1);
});
