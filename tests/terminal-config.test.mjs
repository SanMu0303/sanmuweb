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
