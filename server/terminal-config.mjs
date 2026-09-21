import {createSupabase} from './supabase/client.mjs';
import {validFeedAddress} from './terminal-news.mjs';

const META_KEY = 'terminal_workspace_v2';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const clean = (value, limit) => typeof value === 'string' ? value.trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit) : '';
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const bounded = (value, low, high, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
export const terminalCapabilities = (env = process.env) => ({rss: true, x: Boolean(env.X_BEARER_TOKEN?.trim()), wallet: false, hyperliquid: false, binance: false});

function id(value) {
  const result = clean(value, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(result)) fail('监听项标识不正确');
  return result;
}
function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max) fail(`${label}最多保存 ${max} 项`);
  return value;
}
function unique(rows) {
  if (new Set(rows.map(row => row.id)).size !== rows.length) fail('监听项标识重复');
  return rows;
}
export function normalizeTerminalConfig(input, env = process.env) {
  const value = record(input), capability = terminalCapabilities(env);
  const sources = unique(list(value.sources || [], 8, '消息来源').map(raw => {
    const item = record(raw), kind = item.kind;
    if (!['rss', 'x', 'wallet'].includes(kind)) fail('消息来源类型不支持');
    const address = clean(item.address, 512);
    if (kind === 'rss' && !validFeedAddress(address)) fail('RSS 地址必须是标准 HTTPS 公共地址（443 端口）');
    if (kind === 'x' && !/^(?:https:\/\/(?:www\.)?(?:x|twitter)\.com\/)?@?[A-Za-z0-9_]{1,15}\/?$/.test(address)) fail('请填写有效的 X 账号或账号链接');
    if (kind === 'wallet' && (!address || address.length > 200)) fail('请填写钱包地址');
    const keywords = (Array.isArray(item.keywords) ? item.keywords : typeof item.keywords === 'string' ? item.keywords.split(/[,，\n]/) : []).map(word => clean(word, 40)).filter(Boolean).slice(0, 8);
    const market = ['crypto', 'stocks', 'indices', 'forex', 'commodities', 'macro'].includes(item.market) ? item.market : 'other';
    const requestedEnabled = item.requestedEnabled !== false && item.enabled !== false;
    return {id: id(item.id), kind, name: clean(item.name, 80) || (kind === 'rss' ? new URL(address).hostname : address), address: kind === 'x' ? address.replace(/\/$/, '') : address, market, keywords: [...new Set(keywords)], sound: item.sound === true, requestedEnabled, enabled: requestedEnabled && capability[kind] === true};
  }));
  const wallets = unique(list(value.wallets || [], 20, '关注账户').map(raw => {
    const item = record(raw), platform = item.platform;
    if (!['hyperliquid', 'binance'].includes(platform)) fail('账户平台不支持');
    const address = clean(item.address, 200);
    if (platform === 'hyperliquid' && !/^0x[a-fA-F0-9]{40}$/.test(address)) fail('Hyperliquid 请填写 0x 开头的完整公开钱包地址');
    if (platform === 'binance' && (!address || /\s/.test(address))) fail('请填写币安公开账户标识或公开记录链接');
    const requestedEnabled = item.requestedEnabled !== false && item.enabled !== false;
    return {id: id(item.id), platform, name: clean(item.name, 80) || `${platform} 账户`, address, requestedEnabled, enabled: requestedEnabled && capability[platform] === true};
  }));
  const preferences = record(value.preferences), panelSound = record(preferences.panelSound);
  return {version: 2, sources, wallets, preferences: {splitRatio: bounded(preferences.splitRatio, 0.28, 0.55, 0.38), volume: bounded(preferences.volume, 0, 1, 0.35), sound: preferences.sound === true, panelSound: {market: panelSound.market !== false, selected: panelSound.selected !== false, smart: panelSound.smart !== false}}};
}

/** User metadata is preferences only. It is never used for membership/admin authorization. */
export function createTerminalConfig({env = process.env, transport = fetch, client = createSupabase(env, transport), now = () => new Date().toISOString()} = {}) {
  function owner(identity) {
    if (!identity?.signedIn || typeof identity.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(identity.id)) fail('请登录后管理监听配置', 401);
    return identity.id;
  }
  async function read(identity) {
    const userId = owner(identity);
    const result = await client.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
    const raw = result?.user || result;
    if (raw?.id !== userId) fail('监听配置读取失败', 502);
    const saved = record(raw.user_metadata?.[META_KEY]);
    let config;
    try { config = normalizeTerminalConfig(saved, env); } catch { config = normalizeTerminalConfig({}, env); }
    return {config, updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : null, capabilities: terminalCapabilities(env)};
  }
  async function write(identity, input) {
    const userId = owner(identity), config = normalizeTerminalConfig(input, env), updatedAt = now();
    if (Buffer.byteLength(JSON.stringify({...config, updatedAt}), 'utf8') > 8_000) fail('监听配置过大，请减少来源或关键词', 413);
    // Auth merges this metadata key. Sending only our key preserves nickname/avatar and
    // avoids round-tripping app_metadata, email, credentials, or unrelated preferences.
    const current = await client.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
    const currentUser = current?.user || current;
    if (currentUser?.id !== userId) fail('监听配置写入失败', 502);
    const userMetadata = record(currentUser.user_metadata);
    userMetadata[META_KEY] = {...config, updatedAt};
    await client.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({user_metadata: userMetadata})});
    return {config, updatedAt, capabilities: terminalCapabilities(env)};
  }
  return {read, write};
}
