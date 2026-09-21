import {createTerminalApi} from '@/server/terminal-api.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const api = createTerminalApi();
export async function GET(request: Request) { return api.handle(request, 'config'); }
export async function PUT(request: Request) { return api.handle(request, 'config'); }
