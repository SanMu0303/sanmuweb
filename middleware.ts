import {NextResponse} from 'next/server';

export function middleware(request: Request & {nextUrl: URL}) {
  const pathname = request.nextUrl.pathname;
  if (pathname === '/api/terminal' || (pathname.startsWith('/api/terminal/') && pathname !== '/api/terminal/data')) {
    return NextResponse.json({error: '旧交易终端已替换，请使用 /terminal/'}, {
      status: 410,
      headers: {'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff'},
    });
  }
  return NextResponse.next();
}

export const config = {matcher: ['/api/terminal/:path*']};
