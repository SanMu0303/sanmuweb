export function terminalRetiredResponse() {
  return Response.json({error: '旧交易终端已替换，请使用 /terminal/'}, {
    status: 410,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
