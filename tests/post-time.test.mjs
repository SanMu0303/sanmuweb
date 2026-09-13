import test from 'node:test';
import assert from 'node:assert/strict';
import {formatPostTime} from '../lib/postTime.mjs';
import {normalizePost} from '../server/post-model.mjs';
test('post timestamps use Shanghai minutes, 24-hour midnight and publication fallback',()=>{
 assert.equal(formatPostTime('2026-09-13T06:32:59Z'),'09-13 14:32');
 assert.equal(formatPostTime('2026-09-13T06:32:00Z',null,true),'2026-09-13 14:32');
 assert.equal(formatPostTime('2026-09-12T16:00:00Z'),'09-13 00:00');
 assert.equal(formatPostTime(null,'2026-09-13T01:08:00Z'),'09-13 09:08');
 assert.equal(formatPostTime('invalid','2026-09-13T13:47:00Z'),'09-13 21:47');
 assert.equal(formatPostTime('2026-09-13 14:32'),'09-13 14:32');
 const legacy=normalizePost({publishedAt:'2026-09-13',publishedAtTime:'2026-09-13T06:32:00Z'});
 assert.equal(legacy.updatedAt,legacy.publishedAt);
});
