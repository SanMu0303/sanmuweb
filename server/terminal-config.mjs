import {configuration, createSupabase} from './supabase/client.mjs';
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
  const preferences = record(value.preferences), panelSound = record(preferences.panelSound), panelSizes = record(preferences.panelSizes);
  return {version: 2, sources, wallets, preferences: {
    splitRatio: bounded(preferences.splitRatio, 0.28, 0.55, 0.38),
    volume: bounded(preferences.volume, 0, 1, 0.35),
    sound: preferences.sound === true,
    panelSound: {market: panelSound.market !== false, selected: panelSound.selected !== false, smart: panelSound.smart !== false},
    // Relative grid weights. CSS enforces a 160px minimum for each window;
    // keeping the persisted values bounded prevents an accidental drag from
    // making a panel effectively disappear.
    panelSizes: {
      market: bounded(panelSizes.market, 0.2, 0.6, 1 / 3),
      selected: bounded(panelSizes.selected, 0.2, 0.6, 1 / 3),
      smart: bounded(panelSizes.smart, 0.2, 0.6, 1 / 3)
    }
  }};
}

/** User metadata is preferences only. It is never used for membership/admin authorization. */
export function createTerminalConfig({env = process.env, transport = fetch, client = createSupabase(env, transport), now = () => new Date().toISOString()} = {}) {
  function owner(identity) {
    if (!identity?.signedIn || typeof identity.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(identity.id)) fail('请登录后管理监听配置', 401);
    return identity.id;
  }
  async function userRequest(identity, options = {}) {
    const {url, key} = client.config || configuration(env);
    const response = await transport(`${url}/auth/v1/user`, {
      ...options,
      headers: {apikey: key, Authorization: `Bearer ${identity.accessToken}`, ...(options.body ? {'Content-Type': 'application/json'} : {})},
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      // A failed/expired user token must not silently fall back to elevated
      // credentials. The next website request will revalidate the session.
      const status = [401, 403, 429].includes(response.status) ? response.status : 503;
      fail(status === 401 ? '登录已过期，请重新登录' : '监听配置服务暂时不可用', status);
    }
    return response.json();
  }
  const hasUserToken = identity => typeof identity.accessToken === 'string' && identity.accessToken.length > 0;
  async function loadUser(identity, userId) {
    const result = hasUserToken(identity)
      ? await userRequest(identity)
      : await client.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
    const user = result?.user || result;
    if (user?.id !== userId) fail('监听配置读取失败', 502);
    return user;
  }
  async function read(identity) {
    const userId = owner(identity);
    const raw = await loadUser(identity, userId);
    const saved = record(raw.user_metadata?.[META_KEY]);
    let config;
    try { config = normalizeTerminalConfig(saved, env); } catch { config = normalizeTerminalConfig({}, env); }
    return {config, updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : null, capabilities: terminalCapabilities(env)};
  }
  async function write(identity, input) {
    const userId = owner(identity), config = normalizeTerminalConfig(input, env), updatedAt = now();
    if (Buffer.byteLength(JSON.stringify({...config, updatedAt}), 'utf8') > 8_000) fail('监听配置过大，请减少来源或关键词', 413);
    const currentUser = await loadUser(identity, userId);
    if (hasUserToken(identity)) {
      // The authenticated /user endpoint merges `data` into user_metadata.
      // Only our preference key is writable; email, password, app_metadata,
      // nickname and avatar are not copied or accepted from browser input.
      const saved = await userRequest(identity, {method: 'PUT', body: JSON.stringify({data: {[META_KEY]: {...config, updatedAt}}})});
      if ((saved?.user || saved)?.id !== userId) fail('监听配置写入失败', 502);
    } else {
      // Compatibility for server callers which still supply only an identity
      // and an Admin API client. Web routes always prefer the session token.
      const userMetadata = {...record(currentUser.user_metadata), [META_KEY]: {...config, updatedAt}};
      await client.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({user_metadata: userMetadata})});
    }
    return {config, updatedAt, capabilities: terminalCapabilities(env)};
  }
  return {read, write};
}
