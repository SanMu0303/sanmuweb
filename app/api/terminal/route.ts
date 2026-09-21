import {createAuth} from '@/server/supabase/auth.mjs';
import {checkMutation, publicOrigin} from '@/server/supabase/request-security.mjs';
import {createTerminalNews} from '@/server/terminal-news.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const service = createTerminalNews();
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}});

async function body(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 50_000) return json({error: '消息来源配置过大'}, 413);
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json({error: '内容格式不正确'}, 400);
    return value as {sources?: unknown};
  } catch { return json({error: '内容格式不正确'}, 400); }
}

export async function GET() {
  try { return json(await service.query()); }
  catch (error) { return json({error: error instanceof Error ? error.message : '消息服务暂时不可用'}, Number((error as {status?: number})?.status) || 502); }
}

export async function POST(request: Request) {
  const check = checkMutation(request, process.env);
  if (!check.ok) return json({error: check.reason === 'origin' ? '请求来源不正确，请从当前网站重新打开终端' : '请求内容类型不正确，请使用 JSON'}, 403);
  const auth = createAuth(process.env);
  try {
    const identity = await auth.identify(request);
    if (!identity.signedIn) return auth.applyCookies(request, json({error: '请先登录后管理自选消息'}, 401), publicOrigin(request, process.env).startsWith('https:'));
    const input = await body(request);
    if (input instanceof Response) return auth.applyCookies(request, input, publicOrigin(request, process.env).startsWith('https:'));
    return auth.applyCookies(request, json(await service.query(input.sources)), publicOrigin(request, process.env).startsWith('https:'));
  } catch (error) {
    const status = Number((error as {status?: number})?.status) || 502;
    return auth.applyCookies(request, json({error: error instanceof Error ? error.message : '消息服务暂时不可用'}, status), publicOrigin(request, process.env).startsWith('https:'));
  }
}
