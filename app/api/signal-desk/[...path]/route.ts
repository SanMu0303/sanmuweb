import {createSignalDeskMarket} from '@/server/signal-desk-market.mjs';

// Binance's public USDⓈ-M REST API is more reliable from a Node runtime than
// from the Edge egress used by the previous deployment.  Keep the function
// close to the site's primary audience, while the browser-side provider still
// has a fixed, CORS-enabled Binance fallback for read-only public endpoints.
// No user-supplied upstream URL, credential, or private endpoint is accepted.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'hkg1';

const market = createSignalDeskMarket();

type RouteContext = {params: Promise<{path?: string[]}>};

const SCANNER_UNAVAILABLE = {
  error: '服务端 SSE 推送在当前部署环境中尚未启用',
  code: 'scanner_unavailable',
  signals: [],
  status: {
    state: 'browser_local',
    transport: 'not_configured',
    reason: '终端当前使用浏览器直连币安公共 WebSocket；服务端常驻扫描器尚未配置。',
  },
};

// REST snapshots are available on Vercel, while the terminal runs its single
// browser-local Binance WebSocket only while a user keeps the desk open. Keep
// this status separate from SSE: it accurately describes a live local scan,
// without pretending Vercel is hosting a durable background worker.
const SCANNER_STATUS = {
  signals: [],
  status: {
    state: 'browser_local',
    transport: 'browser_websocket',
    scope: '币安 USDⓈ-M · 价格、成交量、OI 与新高/新低',
    reason: '终端打开时由浏览器直连币安公共行情流；资金费率、强平和系统信号未纳入当前规则。关闭页面后不继续后台扫描。',
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
  if (endpoint === 'signals/stream' || endpoint === 'stream') {
    return scannerUnavailableResponse();
  }
  if (endpoint === 'signals') return Response.json(SCANNER_STATUS, {headers: headers()});
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
          limit: url.searchParams.get('limit') || undefined,
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
      case 'contract-heat':
        return response(await market.contractHeat(common));
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
  if (pathName(path) === 'config') {
    // Scanner settings live in the current browser. A serverless route must
    // not claim to configure a non-existent shared background scanner.
    return Response.json({accepted: false, ...SCANNER_STATUS}, {headers: headers()});
  }
  return Response.json({error: '接口不存在', code: 'not_found'}, {status: 404, headers: headers()});
}
