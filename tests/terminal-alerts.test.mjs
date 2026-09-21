import test from 'node:test';
import assert from 'node:assert/strict';
import {freshEvents,mergeEvents,matchesReminder} from '../lib/terminal-alerts.mjs';
const now=Date.parse('2026-09-21T10:02:00Z');
const item=(id,delta=0)=>({id,publishedAt:new Date(now-delta).toISOString(),title:'Bitcoin news',summary:'market',sourceId:'a'});
test('only fresh polling events notify; first load, manual refresh, duplicate, old and reconnect are quiet',()=>{
 const items=[item('new'),item('seen'),item('historical',120_000)];
 for(const reason of ['initial','manual','page'])assert.deepEqual(freshEvents(new Set(),items,{reason,lastSuccess:now-60_000,now}),[]);
 assert.deepEqual(freshEvents(new Set(['seen']),items,{reason:'poll',lastSuccess:now-60_000,now}).map(x=>x.id),['new']);
 assert.deepEqual(freshEvents(new Set(),items,{reason:'poll',lastSuccess:now-100_000,now}),[]);
});
test('bounded timeline deduplicates and sorts',()=>{assert.deepEqual(mergeEvents([item('a',2000),item('b',1000)],[item('b'),item('c',500)],2).map(x=>x.id),['b','c']);});
test('selected sound matches only enabled sources and keyword rules',()=>{const s={id:'a',enabled:true,sound:true,keywords:'bitcoin'};assert.equal(matchesReminder(item('a'),'selected',[s]),true);assert.equal(matchesReminder(item('a'),'selected',[{...s,sound:false}]),false);assert.equal(matchesReminder(item('a'),'selected',[{...s,keywords:'ether'}]),false);});
