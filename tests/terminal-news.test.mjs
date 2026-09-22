import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerminalNews, DEFAULT_SOURCES, isPrivateAddress, normalizeSources, parseRss} from '../server/terminal-news.mjs';

const feed = (rows) => `<?xml version="1.0"?><rss><channel>${rows.map(row => `<item><guid>${row.id}</guid><title>${row.title}</title><description><![CDATA[${row.summary}]]></description><link>${row.url}</link><pubDate>${row.date}</pubDate></item>`).join('')}</channel></rss>`;
const resolver = async hostname => [{address: hostname === 'bad.test' ? '127.0.0.1' : '93.184.216.34', family: 4}];

test('blocks private, special and mapped addresses before any source request', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.2', '169.254.1.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
});

test('RSS parser strips markup and unsafe links without returning raw HTML', () => {
  const items = parseRss(feed([{id: '1', title: '<b>Market</b>', summary: '<img src=x>Safe &amp; sound', url: 'javascript:alert(1)', date: '2026-09-21T00:00:00Z'}]), {id: 'demo', name: 'Demo'});
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Market');
  assert.equal(items[0].summary, 'Safe & sound');
  assert.equal(items[0].url, '');
  assert.equal(items[0].sourceId, 'demo');
});

test('RSS CDATA links and RFC dates are decoded before validation and parsing', () => {
  const rows = parseRss(`<rss><channel><item>
    <title><![CDATA[Research update]]></title>
    <link><![CDATA[https://cointelegraph.com/news/example?utm_source=rss&amp;ref=feed]]></link>
    <pubDate><![CDATA[Mon, 21 Sep 2026 14:00:00 GMT]]></pubDate>
  </item><item>
    <title>Policy update</title>
    <link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/example.htm]]></link>
    <pubDate><![CDATA[ Mon, 21 Sep 2026 10:00:00 -0400 ]]></pubDate>
  </item></channel></rss>`,{id:'test',name:'Test'});
  assert.equal(rows[0].url, 'https://cointelegraph.com/news/example?utm_source=rss&ref=feed');
  assert.equal(rows[0].publishedAt, '2026-09-21T14:00:00.000Z');
  assert.equal(rows[1].url, 'https://www.federalreserve.gov/newsevents/pressreleases/example.htm');
  assert.equal(rows[1].publishedAt, '2026-09-21T14:00:00.000Z');
});

test('CDATA never bypasses unsafe-link checks and unknown dates never become epoch dates', () => {
  const rows = parseRss(`<rss><channel><item><title>Unsafe</title><link><![CDATA[javascript:alert(1)]]></link><pubDate><![CDATA[not a date]]></pubDate></item>
    <item><title>Private</title><link><![CDATA[https://127.0.0.1/private]]></link></item>
    <item><title>Fallback date</title><pubDate></pubDate><dc:date><![CDATA[2026-09-21T14:00:00Z]]></dc:date></item></channel></rss>`,{id:'test',name:'Test'});
  assert.equal(rows[0].url, '');
  assert.equal(rows[1].url, '');
  assert.equal(rows[0].publishedAt, '');
  assert.equal(rows[1].publishedAt, '');
  assert.equal(rows[2].publishedAt, '2026-09-21T14:00:00.000Z');
});

test('unknown publication dates sort last and remain pageable without fabricating a timestamp', async () => {
  const service = createTerminalNews({resolver,fetchImpl:async()=>new Response(feed([
    {id:'unknown-a',title:'Unknown A',summary:'A',url:'https://example.com/a',date:''},
    {id:'known',title:'Known',summary:'K',url:'https://example.com/k',date:'2026-09-21T14:00:00Z'},
    {id:'unknown-b',title:'Unknown B',summary:'B',url:'https://example.com/b',date:'invalid'},
  ]))});
  const sources=[{id:'test',kind:'rss',name:'Test',address:'https://feed.test/feed.xml'}];
  const first=await service.query(sources,{limit:1});
  const second=await service.query(sources,{limit:1,cursor:first.nextCursor});
  const third=await service.query(sources,{limit:1,cursor:second.nextCursor});
  assert.deepEqual([first,second,third].map(page=>page.items[0].id),['known','unknown-a','unknown-b']);
  assert.equal(second.items[0].publishedAt,'');
  assert.equal(third.items[0].publishedAt,'');
  assert.equal(third.nextCursor,null);
});

test('GET query returns bounded, deduplicated items and source statuses', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('bad.test')) return new Response('no', {status: 503});
    return new Response(feed([
      {id: 'same', title: 'A', summary: 'one', url: 'https://example.com/a', date: '2026-09-21T01:00:00Z'},
      {id: 'same2', title: 'A duplicate', summary: 'two', url: 'https://example.com/a', date: '2026-09-21T00:00:00Z'},
    ]), {status: 200});
  };
  const service = createTerminalNews({fetchImpl, resolver, now: () => 1_000_000});
  const result = await service.query([
    {id: 'one', kind: 'rss', name: 'One', address: 'https://feed.test/one.xml'},
    {id: 'bad', kind: 'rss', name: 'Bad', address: 'https://bad.test/feed.xml'},
  ]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.sources.map(source => source.status), ['ok', 'error']);
  assert.equal(result.pollInterval, 60);
  assert.equal(calls.length, 1);
});

test('DNS rebinding/private answer is rejected and not passed to transport', async () => {
  let called = false;
  const service = createTerminalNews({fetchImpl: async () => { called = true; return new Response(''); }, resolver: async () => [{address: '192.168.1.4', family: 4}]});
  const result = await service.query([{id: 'private', kind: 'rss', name: 'Private', address: 'https://public-name.test/feed.xml'}]);
  assert.equal(called, false);
  assert.equal(result.sources[0].status, 'error');
  assert.match(result.sources[0].message, /不安全/);
});

test('cache and inflight deduplicate concurrent source requests', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return new Response(feed([{id: '1', title: 'A', summary: 'ok', url: 'https://example.com/a', date: '2026-09-21'}])); };
  const service = createTerminalNews({fetchImpl, resolver, now: () => 1_000_000});
  await Promise.all([
    service.query([{id: 'one', kind: 'rss', name: 'One', address: 'https://feed.test/one.xml'}]),
    service.query([{id: 'one', kind: 'rss', name: 'One', address: 'https://feed.test/one.xml'}]),
  ]);
  assert.equal(calls, 1);
  await service.query([{id: 'one', kind: 'rss', name: 'One', address: 'https://feed.test/one.xml'}]);
  assert.equal(calls, 1);
});

test('custom source cap, HTTPS-only RSS and X token behavior', async () => {
  assert.equal(DEFAULT_SOURCES.length >= 2, true);
  assert.throws(() => normalizeSources(Array.from({length: 9}, (_, i) => ({id: String(i), kind: 'rss', name: 'x', address: `https://feed.test/${i}`}))), /最多/);
  assert.throws(() => normalizeSources([{id: 'http', kind: 'rss', name: 'x', address: 'http://feed.test/feed'}]), /HTTPS/);
  const service = createTerminalNews({resolver, now: () => 1_000_000});
  const result = await service.query([{id: 'x', kind: 'x', name: 'Trader', address: '@trader'}]);
  assert.equal(result.sources[0].status, 'unconfigured');
  assert.match(result.sources[0].message, /X_BEARER_TOKEN/);
});
