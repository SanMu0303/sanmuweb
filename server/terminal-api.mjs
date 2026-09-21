import {createAuth} from './supabase/auth.mjs';
import {checkMutation, publicOrigin} from './supabase/request-security.mjs';
import {createTerminalConfig} from './terminal-config.mjs';
import {createTerminalNews} from './terminal-news.mjs';
import {createSelectedNews, querySmartMoney} from './terminal-adapters.mjs';

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie'}});
const fail = (message, status) => { throw Object.assign(new Error(message), {status}); };
const query = request => Object.fromEntries(['q', 'market', 'source', 'cursor', 'limit'].map(key => [key, new URL(request.url).searchParams.get(key) || '']));

async function readConfig(request) {
  if (Number(request.headers.get('content-length') || 0) > 30_000) fail('监听配置过大', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('请提交配置', 400);
  let size = 0;
  const chunks = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 30_000) { await reader.cancel(); fail('监听配置过大', 413); }
    chunks.push(Buffer.from(value));
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('配置格式不正确', 400); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('配置格式不正确', 400);
  return result;
}

/** Every user-owned route identifies the session server-side; user IDs never come from input. */
export function createTerminalApi({env = process.env, news = createTerminalNews({env}), selected = createSelectedNews({env, news}), authFactory = () => createAuth(env), configFactory = () => createTerminalConfig({env})} = {}) {
  async function handle(request, resource) {
    let auth;
    const finish = response => auth ? auth.applyCookies(request, response, publicOrigin(request, env).startsWith('https:')) : response;
    try {
      if (resource === 'news') {
        if (request.method === 'GET') return json(await news.query(undefined, query(request)));
        if (request.method !== 'POST') return json({error: '请求方式不支持'}, 405);
        const check = checkMutation(request, env);
        if (!check.ok) return json({error: check.reason === 'origin' ? '请求来源不正确，请从本站重新打开终端' : '请使用 JSON 请求消息'}, 403);
        auth = authFactory();
        const identity = await auth.identify(request);
        if (!identity.signedIn) return finish(json({error: '请登录后同步自选消息', code: 'sign_in_required'}, 401));
        const input = await readConfig(request);
        if (!Array.isArray(input.sources)) fail('消息来源格式不正确', 400);
        return finish(json(await news.query(input.sources, query(request))));
      }
      const allowed = resource === 'config' ? ['GET', 'PUT'] : ['GET'];
      if (!allowed.includes(request.method)) return json({error: '请求方式不支持'}, 405);
      if (request.method === 'PUT') {
        const check = checkMutation(request, env);
        if (!check.ok) return json({error: check.reason === 'origin' ? '请求来源不正确，请从本站重新打开终端' : '请使用 JSON 保存配置'}, 403);
      }
      auth = authFactory();
      // Prefer the full, already validated session context so preference
      // stores can use the user's access token. Test doubles and legacy auth
      // adapters may only expose identify(), so keep that compatibility path.
      const identity = typeof auth.session === 'function' ? await auth.session(request) : await auth.identify(request);
      if (!identity.signedIn) return finish(json({error: '请登录后使用个人监听配置', code: 'sign_in_required'}, 401));
      const store = configFactory();
      if (resource === 'config') return finish(json(request.method === 'PUT' ? await store.write(identity, await readConfig(request)) : await store.read(identity)));
      const {config} = await store.read(identity);
      if (resource === 'selected') return finish(json(await selected.query(config, query(request))));
      if (resource === 'smart-money') return finish(json(querySmartMoney(config)));
      return finish(json({error: '接口不存在'}, 404));
    } catch (error) {
      const code = Number(error?.status) || 502;
      const status = [400,401,403,404,405,413,429,503].includes(code) ? code : 502;
      return finish(json({error: status >= 500 ? '终端服务暂时不可用，请稍后重试' : error instanceof Error ? error.message : '请求失败'}, status));
    }
  }
  return {handle};
}
