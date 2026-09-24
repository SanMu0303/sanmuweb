import {createSignalDeskMarket} from '@/server/signal-desk-market.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'hkg1';

const market = createSignalDeskMarket();

type RouteContext = {params: Promise<{path?: string[]}>};

const SCANNER_UNAVAILABLE = {
  error: '实时信号扫描在当前部署环境中尚未启用',
  code: 'scanner_unavailable',
  signals: [],
  status: {
    state: 'unavailable',
    transport: 'not_configured',
    reason: '该功能需要常驻扫描器和长连接；当前无状态部署不会伪造实时信号。',
  },
};

function headers(meta?: {source?: string; sourceLabel?: string; fallback?: boolean; degraded?: string[]}, retryAfter?: number) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    ...(meta?.source ? {'X-Signal-Desk-Source': meta.source} : {}),
    ...(meta?.sourceLabel ? {'X-Signal-Desk-Source-Label': encodeURIComponent(meta.sourceLabel)} : {}),
    ...(meta?.fallback ? {'X-Signal-Desk-Fallback': 'true'} : {'X-Signal-Desk-Fallback': 'false'}),
    ...(meta?.degraded?.length ? {'X-Signal-Desk-Degraded': meta.degraded.join(',')} : {}),
    ...(retryAfter && retryAfter > 0 ? {'Retry-After': String(Math.ceil(retryAfter))} : {}),
  };
}

function response(result: {value: unknown; meta: {source?: string; sourceLabel?: string; fallback?: boolean; degraded?: string[]}}) {
  return Response.json(result.value, {headers: headers(result.meta)});
}

function errorResponse(caught: unknown) {
  const error = caught as {status?: number; code?: string; source?: string; retryAfter?: number; message?: string};
  const status = [400, 404, 429, 503].includes(Number(error?.status)) ? Number(error.status) : 502;
  return Response.json({
    error: typeof error?.message === 'string' ? error.message : '行情服务暂时不可用',
    code: error?.code || 'upstream_unavailable',
    source: error?.source || null,
  }, {status, headers: headers(error?.source ? {source: error.source} : undefined, error?.retryAfter)});
}

function scannerUnavailableResponse() {
  // The imported desk used a process-local scanner plus SSE.  A serverless
  // route cannot truthfully promise either durable scanning or a live stream,
  // so expose a stable, explicit failure instead of returning mock signals.
  return Response.json(SCANNER_UNAVAILABLE, {status: 503, headers: headers()});
}

function pathName(path: string[]) {
  return path.join('/');
}

export async function GET(request: Request, context: RouteContext) {
  const {path = []} = await context.params;
  const endpoint = pathName(path);
  if (endpoint === 'signals' || endpoint === 'signals/stream' || endpoint === 'stream') {
    return scannerUnavailableResponse();
  }
  if (endpoint === 'config') {
    return Response.json({error: '此接口仅支持 POST', code: 'method_not_allowed'}, {
      status: 405,
      headers: {...headers(), Allow: 'POST'},
    });
  }
  if (path.length !== 1) return Response.json({error: '接口不存在', code: 'not_found'}, {status: 404, headers: headers()});

  const url = new URL(request.url);
  const common = {source: url.searchParams.get('source') || undefined};
  try {
    switch (endpoint) {
      case 'klines':
        return response(await market.klines({
          ...common,
          symbol: url.searchParams.get('symbol') || undefined,
          timeframe: url.searchParams.get('timeframe') || undefined,
          at: url.searchParams.get('at') || undefined,
          before: url.searchParams.get('before') || undefined,
          fresh: url.searchParams.get('fresh') === '1',
        }));
      case 'oi':
        return response(await market.oi({...common, symbol: url.searchParams.get('symbol') || undefined}));
      case 'oi-history':
        return response(await market.oiHistory({
          ...common,
          symbol: url.searchParams.get('symbol') || undefined,
          timeframe: url.searchParams.get('timeframe') || undefined,
          at: url.searchParams.get('at') || undefined,
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined,
        }));
      case 'contracts':
        return response(await market.contracts(common));
      case 'universe':
        return response(await market.universe(common));
      case 'tickers':
        return response(await market.tickers(common));
      case 'market-summary':
        return response(await market.marketSummary({...common, symbol: url.searchParams.get('symbol') || undefined}));
      default:
        return Response.json({error: '接口不存在', code: 'not_found'}, {status: 404, headers: headers()});
    }
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const {path = []} = await context.params;
  if (pathName(path) === 'config') return scannerUnavailableResponse();
  return Response.json({error: '接口不存在', code: 'not_found'}, {status: 404, headers: headers()});
}
