import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerminalApi} from '../server/terminal-api.mjs';

const env = {APP_ORIGIN:'https://site.test'};
const headers = {'host':'site.test','origin':'https://site.test','content-type':'application/json'};
const identity = {signedIn:true,id:'00000000-0000-0000-0000-000000000001'};
const noCookieAuth = {identify: async () => ({signedIn:false}), applyCookies: (_request,response) => response};

test('public news GET only uses the curated adapter and supports query filters', async () => {
  let filters;
  const api = createTerminalApi({env, news:{query:async (_sources, value) => { filters = value; return {items:[],sources:[],fetchedAt:'now',pollInterval:60}; }}, authFactory:()=>noCookieAuth});
  const response = await api.handle(new Request('https://site.test/api/terminal/news?market=crypto&limit=3'), 'news');
  assert.equal(response.status, 200);
  assert.equal(filters.market, 'crypto');
  assert.equal(filters.limit, '3');
});

test('custom news POST requires login and same-origin JSON', async () => {
  let called = 0;
  const news = {query:async sources => {called += 1; return {items:[],sources:sources.map(source=>({id:source.id,status:'ok'})),fetchedAt:'now',pollInterval:60};}};
  const api = createTerminalApi({env,news,authFactory:()=>noCookieAuth});
  const denied = await api.handle(new Request('https://site.test/api/terminal/news',{method:'POST',headers,body:JSON.stringify({sources:[]})}), 'news');
  assert.equal(denied.status, 401);
  assert.equal(called, 0);
  const foreign = await api.handle(new Request('https://site.test/api/terminal/news',{method:'POST',headers:{...headers,origin:'https://evil.test'},body:'{}'}), 'news');
  assert.equal(foreign.status, 403);
});

test('config PUT is protected and delegates only authenticated identity', async () => {
  let written;
  const auth = {identify:async () => identity, applyCookies:(_request,response)=>response};
  const store = {write:async (user,input) => {written = {user,input}; return {config:{version:2,sources:[],wallets:[],preferences:{}},capabilities:{rss:true}};},read:async()=>({})};
  const api = createTerminalApi({env,authFactory:()=>auth,configFactory:()=>store});
  const response = await api.handle(new Request('https://site.test/api/terminal/config',{method:'PUT',headers,body:JSON.stringify({sources:[],wallets:[],preferences:{}})}), 'config');
  assert.equal(response.status, 200);
  assert.equal(written.user.id, identity.id);
  const blocked = await api.handle(new Request('https://site.test/api/terminal/config',{method:'PUT',headers:{...headers,origin:'https://evil.test'},body:'{}'}), 'config');
  assert.equal(blocked.status, 403);
});

test('config and selected routes pass only the verified server session to the store', async () => {
  const session = {...identity,accessToken:'server-session-token'};
  const seen = [];
  const auth = {session:async()=>session,identify:async()=>{throw new Error('session path expected');},applyCookies:(_request,response)=>response};
  const config = {version:2,sources:[],wallets:[],preferences:{}};
  const api = createTerminalApi({env,authFactory:()=>auth,configFactory:()=>({
    read:async user=>{seen.push(user);return {config};},
    write:async user=>{seen.push(user);return {config};}
  }),selected:{query:async()=>({items:[],sources:[]})}});
  const get = await api.handle(new Request('https://site.test/api/terminal/config?userId=someone-else'), 'config');
  assert.equal(get.status, 200);
  assert.equal(JSON.stringify(await get.json()).includes('server-session-token'), false);
  assert.equal((await api.handle(new Request('https://site.test/api/terminal/selected'), 'selected')).status, 200);
  assert.equal((await api.handle(new Request('https://site.test/api/terminal/config',{method:'PUT',headers,body:'{}'}), 'config')).status, 200);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(user=>user===session));
});
