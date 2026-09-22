import {lookup as dnsLookup} from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

const MAX_SOURCES = 8;
const MAX_ITEMS_PER_SOURCE = 30;
const MAX_ITEMS = 100;
const MAX_XML_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 45_000;
const STALE_TTL_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL = 60;

/** Public, primary feeds. These are intentionally kept in code so GET never accepts an
 * arbitrary unauthenticated URL. Users can request their own feeds through authenticated POST. */
export const DEFAULT_SOURCES = Object.freeze([
  {id: 'coindesk', kind: 'rss', name: 'CoinDesk', market: 'crypto', address: 'https://www.coindesk.com/arc/outboundfeeds/rss/'},
  {id: 'federal-reserve', kind: 'rss', name: 'Federal Reserve', market: 'macro', address: 'https://www.federalreserve.gov/feeds/press_all.xml'},
  {id: 'cointelegraph', kind: 'rss', name: 'Cointelegraph', market: 'crypto', address: 'https://cointelegraph.com/rss'},
  {id: 'sec-news', kind: 'rss', name: 'SEC News', market: 'macro', address: 'https://www.sec.gov/news/pressreleases.rss'},
]);

const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const clampText = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function decodeEntities(value) {
  return String(value || '').replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, raw) => {
    const number = raw.toLowerCase().startsWith('x') ? parseInt(raw.slice(1), 16) : parseInt(raw, 10);
    return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  }).replace(/&(amp|lt|gt|quot|apos);/gi, (_, entity) => ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[entity.toLowerCase()]));
}

// XML values can be wrapped in CDATA even when they are dates or links.
// Decode the XML wrapper before URL validation or native date parsing.
function xmlValue(value) {
  return decodeEntities(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')).trim();
}

/** Remove markup before it ever reaches the client. This is deliberately not an HTML renderer. */
export function cleanFeedText(value, max = 500) {
  return clampText(decodeEntities(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').replace(/<[^>]*>/g, ' ')), max);
}

function childXml(block, names) {
  for (const name of names) {
    const tag = name.replace(/[^a-z0-9:_-]/gi, '');
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    if (match) return match[1];
  }
  return '';
}

function linkXml(block) {
  const atom = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/i.exec(block);
  if (atom) return atom[1];
  return childXml(block, ['link', 'guid', 'id']);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(xmlValue(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\u0000-\u001f\u007f]/.test(url.href)) return '';
    if (!url.hostname || isDisallowedHostname(url.hostname)) return '';
    return url.href.slice(0, 2048);
  } catch { return ''; }
}

function isDisallowedHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'local' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (net.isIP(host)) return isPrivateAddress(host);
  return false;
}

function ipv4Number(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((result, part) => result * 256 + Number(part), 0);
}

function ipv6Number(value) {
  let host = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes('%')) host = host.split('%')[0];
  if (host.includes('.')) {
    const marker = host.lastIndexOf(':');
    const v4 = ipv4Number(host.slice(marker + 1));
    if (v4 === null) return null;
    host = `${host.slice(0, marker)}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  if (left.some(part => !/^[0-9a-f]{1,4}$/.test(part)) || right.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  return parts.reduce((result, part) => (result << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function prefix(value, bits, length) { return value >> BigInt(bits - length); }

/** RFC1918, link-local, loopback, documentation, benchmarking, multicast and other special ranges. */
export function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const n = ipv4Number(address);
    if (n === null) return true;
    const ranges = [
      [0, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
      [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
      [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
      [0xe0000000, 4],
    ];
    return ranges.some(([base, bits]) => prefix(BigInt(n), 32, bits) === prefix(BigInt(base), 32, bits));
  }
  if (family === 6) {
    const n = ipv6Number(address);
    if (n === null) return true;
    const ranges = [
      ['0', 128], ['1', 128], ['fc00', 7], ['fe80', 10], ['ff00', 8],
      ['20010db8', 32], ['20010000', 23],
    ];
    if (ranges.some(([base, bits]) => {
      const raw = BigInt(`0x${base}`);
      const basePrefix = raw >> BigInt(Math.max(0, base.length * 4 - bits));
      return prefix(n, 128, bits) === basePrefix;
    })) return true;
    // IPv4-mapped IPv6 addresses must be checked against the IPv4 ranges too.
    if (prefix(n, 128, 96) === 0xffffn) return isPrivateAddress(String(Number(n & 0xffffffffn) >>> 24) + '.' + String(Number((n >> 16n) & 255n)) + '.' + String(Number((n >> 8n) & 255n)) + '.' + String(Number(n & 255n)));
  }
  return false;
}

async function resolvePublic(hostname, resolver = dnsLookup) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!host || isDisallowedHostname(host)) fail('来源地址不安全', 400);
  if (net.isIP(host)) return [{address: host, family: net.isIP(host)}];
  let records;
  try { records = await resolver(host, {all: true, verbatim: true}); } catch { fail('来源地址无法解析', 400); }
  if (!Array.isArray(records) || !records.length || records.some(record => !record?.address || isPrivateAddress(record.address))) fail('来源地址不安全', 400);
  return records.map(record => ({address: record.address, family: record.family || net.isIP(record.address)}));
}

export function validFeedAddress(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname || isDisallowedHostname(url.hostname)) return null;
    if (url.port && url.port !== '443') return null;
    return url;
  } catch { return null; }
}

function sourceId(value) {
  const id = clampText(value, 48).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  return id || `source-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeSources(input, {defaults = DEFAULT_SOURCES} = {}) {
  const list = input === undefined ? defaults : input;
  if (!Array.isArray(list) || list.length > MAX_SOURCES) fail(`最多选择${MAX_SOURCES}个消息来源`, 400);
  const output = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') fail('消息来源格式不正确', 400);
    const kind = raw.kind === 'x' ? 'x' : raw.kind === 'rss' ? 'rss' : '';
    if (!kind) fail('消息来源类型不支持', 400);
    const address = clampText(raw.address, 512);
    const id = sourceId(raw.id || `${kind}-${address}`);
    if (seen.has(id)) continue;
    if (kind === 'rss' && !validFeedAddress(address)) fail('RSS 地址必须使用安全的 HTTPS 地址', 400);
    if (kind === 'x' && !/^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?@?[A-Za-z0-9_]{1,15}$/.test(address)) fail('X 账号地址不正确', 400);
    seen.add(id);
    output.push({id, kind, name: clampText(raw.name || id, 80), address, market: ['crypto', 'stocks', 'indices', 'forex', 'commodities', 'macro'].includes(raw.market) ? raw.market : 'other'});
  }
  return output;
}

function parseDate(value) {
  const text = xmlValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Unknown publication times remain unknown in the response. A finite sort
// sentinel keeps them at the end and makes keyset pagination deterministic.
function eventTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : -8640000000000000;
}

export function parseRss(xml, source) {
  const text = String(xml || '').slice(0, MAX_XML_BYTES);
  const blocks = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  const items = [];
  for (const block of blocks.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const title = cleanFeedText(childXml(block, ['title']), 240);
    const summary = cleanFeedText(childXml(block, ['description', 'summary', 'content', 'content:encoded']), 500);
    const url = safeExternalUrl(linkXml(block));
    const publishedAt = ['pubDate', 'published', 'updated', 'dc:date'].map(name => parseDate(childXml(block, [name]))).find(Boolean) || '';
    const rawId = cleanFeedText(childXml(block, ['guid', 'id']), 256);
    if (!title && !summary) continue;
    const id = clampText(rawId || url || `${source.id}:${title}:${publishedAt}`, 256);
    items.push({id, title: title || source.name, summary, url, sourceId: source.id, sourceName: source.name, publishedAt});
  }
  return items;
}

async function readResponse(response, maxBytes = MAX_XML_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('消息来源内容过大'), {status: 413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function pinnedLookup(records) {
  return (_hostname, options, callback) => options?.all ? callback(null, records) : callback(null, records[0].address, records[0].family);
}

function requestPinned(url, {resolver = dnsLookup, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_XML_BYTES} = {}) {
  return new Promise(async (resolve, reject) => {
    let records;
    try { records = await resolvePublic(url.hostname, resolver); } catch (error) { reject(error); return; }
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname || '/'}${url.search || ''}`,
      method: 'GET',
      headers: {'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.2', 'User-Agent': 'SanMuResearchTerminal/1.0'},
      lookup: pinnedLookup(records),
      ...(url.protocol === 'https:' ? {servername: url.hostname} : {}),
    }, async response => {
      try {
        const body = await readResponse(response, maxBytes);
        resolve({status: response.statusCode || 0, headers: response.headers, text: body});
      } catch (error) { request.destroy(); reject(error); }
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('消息来源请求超时'), {status: 504})));
    request.once('error', reject);
    request.end();
  });
}

async function fetchDocument(url, options) {
  let current = url;
  for (let redirects = 0; redirects <= 2; redirects++) {
    await resolvePublic(current.hostname, options.resolver || dnsLookup);
    const response = options.fetchImpl ? await options.fetchImpl(current.href, {method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS), headers: {'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.2', 'User-Agent': 'SanMuResearchTerminal/1.0'}}) : await requestPinned(current, options);
    const status = Number(response.status || response.statusCode || 0);
    if (status >= 300 && status < 400) {
      const location = response.headers?.get ? response.headers.get('location') : response.headers?.location;
      const next = location ? validFeedAddress(new URL(location, current).href) : null;
      if (!next || redirects === 2) fail('消息来源重定向不安全', 400);
      await resolvePublic(next.hostname, options.resolver || dnsLookup);
      current = next;
      continue;
    }
    if (status < 200 || status >= 300) throw Object.assign(new Error(`消息来源返回 ${status || '未知错误'}`), {status: status || 502});
    const text = typeof response.text === 'string' ? response.text : await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_XML_BYTES) throw Object.assign(new Error('消息来源内容过大'), {status: 413});
    return text;
  }
  fail('消息来源重定向过多', 400);
}

function extractXUsername(address) {
  const raw = String(address || '').trim().replace(/^@/, '');
  const match = /^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?([A-Za-z0-9_]{1,15})$/.exec(raw);
  return match?.[1] || '';
}

async function fetchX(source, options) {
  const token = String(options.env?.X_BEARER_TOKEN || '').trim();
  if (!token) return {items: [], status: 'unconfigured', message: 'X_BEARER_TOKEN 未配置'};
  const username = extractXUsername(source.address);
  if (!username) return {items: [], status: 'error', message: 'X 账号地址不正确'};
  const requester = options.fetchImpl || fetch;
  const headers = {Authorization: `Bearer ${token}`, 'User-Agent': 'SanMuResearchTerminal/1.0'};
  const userResponse = await requester(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=name,username`, {headers, signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS)});
  if (!userResponse.ok) throw new Error(`X 用户查询失败 (${userResponse.status})`);
  const userData = await userResponse.json();
  const userId = userData?.data?.id;
  if (!userId) throw new Error('X 用户不存在');
  const tweets = await requester(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?tweet.fields=created_at,text&max_results=10`, {headers, signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS)});
  if (!tweets.ok) throw new Error(`X 动态查询失败 (${tweets.status})`);
  const data = await tweets.json();
  const items = (Array.isArray(data?.data) ? data.data : []).map(tweet => ({
    id: `x:${tweet.id}`, title: `@${username} 的动态`, summary: cleanFeedText(tweet.text, 500),
    url: safeExternalUrl(`https://x.com/${username}/status/${tweet.id}`), sourceId: source.id, sourceName: source.name,
    publishedAt: parseDate(tweet.created_at) || '',
  }));
  return {items, status: 'ok'};
}


async function fetchRss(source, options) {
  const document = await fetchDocument(validFeedAddress(source.address), options);
  if (!/<(?:rss|feed|rdf:RDF)(?:\s|>)/i.test(document)) throw new Error('来源未返回 RSS/Atom 文档');
  return {items: parseRss(document, source), status: 'ok'};
}

/** Text tags are discovery labels, not a claim that a TradingView symbol can be inferred. */
export function normalizeEvent(item, source = {}) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  const tags = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'USDT', 'USDC'].filter(tag => new RegExp(`\\b${tag}\\b`, 'i').test(text));
  return {...item, market: source.market || 'other', tags};
}

/** Stable keyset paging over a bounded per-request snapshot; no numeric offset drift. */
export function pageEvents(events, options = {}) {
  const query = clampText(options.q, 160).toLowerCase();
  const marketAliases = {'加密资产':'crypto','股票':'stocks','指数':'indices','外汇':'forex','商品':'commodities','宏观':'macro'};
  const marketInput = clampText(options.market, 32);
  const market = marketAliases[marketInput] || marketInput;
  const source = clampText(options.source, 64);
  let filtered = events.filter(item => (!market || market === 'all' || item.market === market) && (!source || source === 'all' || item.sourceId === source) && (!query || `${item.title} ${item.summary} ${item.sourceName} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query)));
  const total = filtered.length;
  if (options.cursor) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(String(options.cursor), 'base64url').toString()); } catch { fail('分页参数不正确'); }
    if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isFinite(cursor[0]) || typeof cursor[1] !== 'string') fail('分页参数不正确');
    filtered = filtered.filter(item => eventTime(item.publishedAt) < cursor[0] || (eventTime(item.publishedAt) === cursor[0] && `${item.sourceId}:${item.id}` > cursor[1]));
  }
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 100)));
  const items = filtered.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = filtered.length > items.length && last ? Buffer.from(JSON.stringify([eventTime(last.publishedAt), `${last.sourceId}:${last.id}`])).toString('base64url') : null;
  return {items, total, nextCursor};
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const urlKey = item.url ? `url:${item.url}` : '';
    const idKey = item.id ? `id:${item.sourceId}:${item.id}` : '';
    if ((urlKey && seen.has(urlKey)) || (idKey && seen.has(idKey))) return false;
    if (urlKey) seen.add(urlKey);
    if (idKey) seen.add(idKey);
    return true;
  }).sort((a, b) => eventTime(b.publishedAt) - eventTime(a.publishedAt) || `${a.sourceId}:${a.id}`.localeCompare(`${b.sourceId}:${b.id}`)).slice(0, MAX_ITEMS);
}

/**
 * Service is dependency-injected for deterministic tests. `fetchImpl` is only used in tests
 * (or to call the fixed X API); RSS production requests use a DNS-pinned node request.
 */
export function createTerminalNews({env = process.env, fetchImpl, resolver = dnsLookup, now = () => Date.now(), cacheTtlMs = CACHE_TTL_MS, staleTtlMs = STALE_TTL_MS, timeoutMs = FETCH_TIMEOUT_MS} = {}) {
  const cache = new Map();
  const inflight = new Map();
  const fetchSource = async source => {
    const key = `${source.kind}:${source.address}`;
    const cached = cache.get(key);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (cached && age < cacheTtlMs) return cached.result;
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      try {
        const result = source.kind === 'x' ? await fetchX(source, {env, fetchImpl, timeoutMs}) : await fetchRss(source, {resolver, fetchImpl, timeoutMs});
        const value = {items: result.items || [], status: result.status || 'ok', ...(result.message ? {message: result.message} : {})};
        cache.set(key, {fetchedAt: now(), result: value});
        return value;
      } catch (error) {
        const message = error instanceof Error ? error.message : '消息来源暂时不可用';
        if (cached && now() - cached.fetchedAt < staleTtlMs) return {...cached.result, status: 'error', message};
        const value = {items: [], status: 'error', message};
        cache.set(key, {fetchedAt: now(), result: value});
        return value;
      } finally { inflight.delete(key); }
    })();
    inflight.set(key, promise);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    return promise;
  };
  async function query(sources, filters = {}) {
    const selected = normalizeSources(sources);
    const results = await Promise.all(selected.map(async source => ({source, result: await fetchSource(source)})));
    const all = dedupeItems(results.flatMap(({source, result}) => result.items.map(item => normalizeEvent({...item, sourceId: source.id, sourceName: source.name}, source))));
    const {items, nextCursor, total} = pageEvents(all, filters);
    return {
      items, nextCursor, total,
      sources: results.map(({source, result}) => ({id: source.id, name: source.name, url: source.address, market: source.market, status: result.status, ...(result.message ? {message: result.message} : {})})),
      fetchedAt: new Date(now()).toISOString(),
      pollInterval: DEFAULT_POLL_INTERVAL,
    };
  }
  return {query, normalizeSources};
}
