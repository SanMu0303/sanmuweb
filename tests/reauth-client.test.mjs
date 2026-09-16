import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Execute the actual browser request helper. React hooks are never called in
// these request-only tests; no browser, network connection or new dependency is needed.
const clientCode=ts.transpileModule(readFileSync(new URL('../lib/live.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText;
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function response(status,data){return {status,ok:status>=200&&status<300,json:async()=>data}}
const challenge=()=>response(428,{error:'请再次验证管理员密码',code:'reauthentication_required'});
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
function assertPayload(calls,path,init,count){
 const matching=calls.filter(call=>call.path===path);
 assert.equal(matching.length,count,'unexpected fetch count for '+path);
 for(const call of matching){assert.equal(call.method,init.method);assert.equal(call.body,init.body);assert.deepEqual(call.headers,init.headers)}
}
const write={method:'PUT',headers:{'Content-Type':'application/json','X-Test':'original-request'},body:JSON.stringify({title:'尚未保存的研究正文',revision:7})};

test('concurrent challenged writes share one verification and each replay the unchanged request once',async()=>{
 const counts=new Map(),opened=deferred();let prompts=0;
 const api=harness(call=>{const count=(counts.get(call.path)||0)+1;counts.set(call.path,count);return count===1?challenge():response(200,{saved:true})});
 api.registerReauthentication(attempt=>{prompts++;opened.resolve(attempt)});
 const first=api.request('/api/admin/articles',write),second=api.request('/api/admin/watchlist',write);
 const attempt=await opened.promise;
 assert.equal(prompts,1);assert.equal(api.calls.length,2);
 attempt.complete();
 assert.deepEqual(await Promise.all([first,second]),[{saved:true},{saved:true}]);
 assert.equal(prompts,1);
 assertPayload(api.calls,'/api/admin/articles',write,2);
 assertPayload(api.calls,'/api/admin/watchlist',write,2);
});

test('an earlier in-flight request whose 428 arrives after verification does not open a second dialog',async()=>{
 const slowResponse=deferred(),opened=deferred(),counts=new Map();let prompts=0;
 const api=harness(call=>{const count=(counts.get(call.path)||0)+1;counts.set(call.path,count);if(call.path.endsWith('/slow')&&count===1)return slowResponse.promise;return count===1?challenge():response(200,{saved:true})});
 api.registerReauthentication(attempt=>{prompts++;opened.resolve(attempt)});
 const slow=api.request('/api/admin/slow',write),fast=api.request('/api/admin/fast',write);
 (await opened.promise).complete();
 assert.deepEqual(await fast,{saved:true});
 slowResponse.resolve(challenge());
 assert.deepEqual(await slow,{saved:true});
 assert.equal(prompts,1);
 assertPayload(api.calls,'/api/admin/slow',write,2);
 assertPayload(api.calls,'/api/admin/fast',write,2);
});

test('a second 428 terminates after one replay without another dialog or an infinite retry',async()=>{
 let prompts=0;
 const api=harness((_call,calls)=>{assert.ok(calls.length<=2,'write was replayed more than once');return challenge()});
 api.registerReauthentication(attempt=>{prompts++;attempt.complete()});
 await assert.rejects(api.request('/api/admin/articles',write),error=>error.status===428&&error.code==='reauthentication_required'&&/未执行/.test(error.message));
 assert.equal(prompts,1);assertPayload(api.calls,'/api/admin/articles',write,2);
});

test('cancel rejects all waiting writes; even late verification success cannot replay them',async()=>{
 const opened=deferred();let prompts=0;
 const api=harness(()=>challenge());api.registerReauthentication(attempt=>{prompts++;opened.resolve(attempt)});
 const results=Promise.allSettled([api.request('/api/admin/articles',write),api.request('/api/admin/watchlist',write)]);
 const attempt=await opened.promise;attempt.cancel();attempt.complete();
 for(const result of await results){assert.equal(result.status,'rejected');assert.equal(result.reason.status,428);assert.equal(result.reason.code,'reauthentication_cancelled');assert.match(result.reason.message,/编辑内容仍保留/)}
 assert.equal(prompts,1);
 assertPayload(api.calls,'/api/admin/articles',write,1);
 assertPayload(api.calls,'/api/admin/watchlist',write,1);
});

test('a late 428 from a request started before cancellation shares that cancellation',async()=>{
 const delayed=deferred(),opened=deferred();let prompts=0;
 const api=harness(call=>call.path.endsWith('/slow')?delayed.promise:challenge());
 api.registerReauthentication(attempt=>{prompts++;opened.resolve(attempt)});
 const results=Promise.allSettled([api.request('/api/admin/slow',write),api.request('/api/admin/fast',write)]);
 (await opened.promise).cancel();delayed.resolve(challenge());
 for(const result of await results){assert.equal(result.status,'rejected');assert.equal(result.reason.code,'reauthentication_cancelled')}
 assert.equal(prompts,1);assert.equal(api.calls.length,2);
});

for(const status of [401,500])test('HTTP '+status+' does not prompt or replay an administrator write',async()=>{
 let prompts=0;const api=harness(()=>response(status,{error:'原请求失败'}));api.registerReauthentication(()=>{prompts++});
 await assert.rejects(api.request('/api/admin/articles',write),error=>error.status===status&&error.message==='原请求失败');
 assert.equal(prompts,0);assertPayload(api.calls,'/api/admin/articles',write,1);
});

test('a network failure does not replay a write or open password verification',async()=>{
 let prompts=0;const api=harness(()=>{throw new TypeError('offline')});api.registerReauthentication(()=>{prompts++});
 await assert.rejects(api.request('/api/admin/articles',write),/网络连接中断/);
 assert.equal(prompts,0);assertPayload(api.calls,'/api/admin/articles',write,1);
});

test('a timed-out membership write keeps its unknown-result warning and is not replayed',async()=>{
 let prompts=0;const api=harness(()=>{throw new DOMException('timed out','TimeoutError')});api.registerReauthentication(()=>{prompts++});
 await assert.rejects(api.request('/api/admin/members/test-user',write),/保存结果尚未确认，请刷新会员列表核对/);
 assert.equal(prompts,0);assertPayload(api.calls,'/api/admin/members/test-user',write,1);
});

test('a 428 without the precise reauthentication code is not replayed',async()=>{
 let prompts=0;const api=harness(()=>response(428,{error:'其他前置条件',code:'another_requirement'}));api.registerReauthentication(()=>{prompts++});
 await assert.rejects(api.request('/api/admin/articles',write),error=>error.status===428&&error.code==='another_requirement');
 assert.equal(prompts,0);assertPayload(api.calls,'/api/admin/articles',write,1);
});

test('the reauthentication endpoint never recursively requests reauthentication',async()=>{
 let prompts=0;const api=harness(()=>challenge());api.registerReauthentication(()=>{prompts++});
 const verification={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-only-password'})};
 await assert.rejects(api.request('/api/auth/reauth',verification),error=>error.status===428);
 assert.equal(prompts,0);assertPayload(api.calls,'/api/auth/reauth',verification,1);
});

test('read requests never open a write-verification dialog or replay',async()=>{
 let prompts=0;const api=harness(()=>challenge());api.registerReauthentication(()=>{prompts++});
 await assert.rejects(api.request('/api/admin/articles'),error=>error.status===428);
 assert.equal(prompts,0);assert.equal(api.calls.length,1);
});
