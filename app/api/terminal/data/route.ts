import {createTerminalMarket} from '@/server/terminal-market.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'hkg1';

const market = createTerminalMarket();

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...(status === 429 ? {'Retry-After': '3'} : {}),
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'snapshot';
  try {
    if (action === 'catalog') return json(await market.catalog());
    if (action === 'candles') return json(await market.candles({
      symbol: url.searchParams.get('symbol') || undefined,
      interval: url.searchParams.get('interval') || undefined,
      limit: url.searchParams.get('limit') || undefined,
      endTime: url.searchParams.get('endTime') || undefined,
    }));
    if (action === 'open-interest') return json(await market.openInterest({
      symbol: url.searchParams.get('symbol') || undefined,
    }));
    if (action !== 'snapshot') return json({error: '行情接口不存在'}, 404);
    return json(await market.snapshot({
      symbol: url.searchParams.get('symbol') || undefined,
      interval: url.searchParams.get('interval') || undefined,
      limit: url.searchParams.get('limit') || undefined,
      endTime: url.searchParams.get('endTime') || undefined,
    }));
  } catch (error) {
    const status = Number((error as {status?: number})?.status) || 502;
    return json({error: error instanceof Error ? error.message : '行情服务暂时不可用'}, [400, 404, 413, 429].includes(status) ? status : 502);
  }
}
