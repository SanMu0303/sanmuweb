import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerminalConfig, normalizeTerminalConfig, terminalCapabilities} from '../server/terminal-config.mjs';
import {createSelectedNews, querySmartMoney} from '../server/terminal-adapters.mjs';

test('terminal config keeps saved intent separate from actual adapter readiness', () => {
  const config = normalizeTerminalConfig({sources:[
    {id:'rss',kind:'rss',name:'Feed',address:'https://example.com/feed.xml',enabled:true},
    {id:'x',kind:'x',name:'Social',address:'@account',enabled:true},
  ], wallets:[{id:'wallet',platform:'hyperliquid',name:'Account',address:'0x0000000000000000000000000000000000000001',enabled:true}]}, {});
  assert.equal(config.sources[0].requestedEnabled, true);
  assert.equal(config.sources[0].enabled, true);
  assert.equal(config.sources[1].requestedEnabled, true);
  assert.equal(config.sources[1].enabled, false);
  assert.equal(config.wallets[0].requestedEnabled, true);
  assert.equal(config.wallets[0].enabled, false);
  assert.equal(terminalCapabilities({}).x, false);
});

test('config store merges only terminal metadata and isolates malformed identities', async () => {
  const calls = [];
  const userId = '00000000-0000-0000-0000-000000000001';
  const client = {request: async (path, options) => {
    calls.push({path, options});
    if (!options) return {id:userId, user_metadata:{nickname:'保留', terminal_workspace_v2:{version:2}}};
    return {id:userId};
  }};
  const store = createTerminalConfig({client, env:{}, now:() => '2026-09-21T00:00:00.000Z'});
  const result = await store.write({signedIn:true,id:userId},{sources:[],wallets:[],preferences:{}});
  assert.equal(result.updatedAt, '2026-09-21T00:00:00.000Z');
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.user_metadata.nickname, '保留');
  assert.equal(body.user_metadata.terminal_workspace_v2.version, 2);
  assert.equal(body.app_metadata, undefined);
  await assert.rejects(() => store.read({signedIn:true,id:'not-an-id'}), /登录/);
});

test('config uses the verified user token without requiring the Supabase Admin API', async () => {
  const userId = '00000000-0000-0000-0000-000000000001';
  const identity = {signedIn:true,id:userId,accessToken:'verified-user-token'};
  const calls = [];
  const client = {config:{url:'https://project.supabase.co',key:'sb_secret_server'},request:async()=>{throw new Error('Admin API must not be used');}};
  const store = createTerminalConfig({env:{},client,now:()=> '2026-09-22T00:00:00.000Z',transport:async (url,options)=>{
    calls.push({url,options});
    return Response.json({id:userId,user_metadata:{nickname:'保留昵称',terminal_workspace_v2:{preferences:{volume:0.6},updatedAt:'saved'}}});
  }});
  assert.equal((await store.read(identity)).config.preferences.volume, 0.6);
  const result = await store.write(identity,{sources:[],wallets:[],preferences:{volume:0.4},user_metadata:{nickname:'覆盖'},app_metadata:{admin:true}});
  assert.equal(result.config.preferences.volume, 0.4);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.url, 'https://project.supabase.co/auth/v1/user');
    assert.equal(call.options.headers.Authorization, 'Bearer verified-user-token');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.redirect, 'error');
  }
  const body = JSON.parse(calls[2].options.body);
  assert.deepEqual(Object.keys(body), ['data']);
  assert.deepEqual(Object.keys(body.data), ['terminal_workspace_v2']);
  assert.equal(body.data.terminal_workspace_v2.updatedAt, '2026-09-22T00:00:00.000Z');
});

test('config rejects mismatched and expired user tokens without elevating to Admin API', async () => {
  const userId = '00000000-0000-0000-0000-000000000001';
  let adminCalls = 0;
  const client = {config:{url:'https://project.supabase.co',key:'server-key'},request:async()=>{adminCalls++;}};
  for (const response of [Response.json({id:'00000000-0000-0000-0000-000000000002'}),Response.json({error:'expired'},{status:401})]) {
    const store = createTerminalConfig({env:{},client,transport:async()=>response});
    await assert.rejects(()=>store.write({signedIn:true,id:userId,accessToken:'wrong-token'},{}),error=>[401,502].includes(error.status));
  }
  assert.equal(adminCalls, 0);
});

test('smart-money adapter never fabricates trades and reports unconfigured platforms', () => {
  const result = querySmartMoney({wallets:[{id:'x',platform:'hyperliquid',name:'H',address:'0x0000000000000000000000000000000000000001',enabled:false}]});
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
  assert.equal(result.accounts[0].status, 'unconfigured');
  assert.equal(result.sources.find(source => source.id === 'binance').status, 'unconfigured');
});

test('selected feed does not report disabled or unsupported sources as live', async () => {
  const fakeNews = {query: async sources => ({items: sources.map(source => ({id:'1',sourceId:source.id,sourceName:source.name,title:'One',summary:'',publishedAt:'2026-09-21T00:00:00.000Z'})),sources:sources.map(source => ({id:source.id,name:source.name,status:'ok'})),fetchedAt:'now',pollInterval:60})};
  const selected = createSelectedNews({env:{},news:fakeNews,now:()=>'now'});
  const result = await selected.query({sources:[
    {id:'rss',kind:'rss',name:'RSS',address:'https://example.com/feed.xml',keywords:[],enabled:true},
    {id:'x',kind:'x',name:'X',address:'@x',keywords:[],enabled:false},
  ]});
  assert.equal(result.items.length, 1);
  assert.equal(result.sources.find(source => source.id === 'rss').status, 'ok');
  assert.equal(result.sources.find(source => source.id === 'x').status, 'unconfigured');
});
