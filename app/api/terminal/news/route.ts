import {createTerminalApi} from '@/server/terminal-api.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const api = createTerminalApi();
export async function GET(request: Request) { return api.handle(request, 'news'); }
export async function POST(request: Request) { return api.handle(request, 'news'); }
