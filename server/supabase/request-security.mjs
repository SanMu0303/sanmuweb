// NextRequest.url can contain the internal Next.js hostname rather than the
// browser's Host. Use Host + transport protocol, or an explicit deployment URL.
// Do not trust arbitrary X-Forwarded-Host / X-Forwarded-Proto headers.
export function publicOrigin(request,env={}) {
 if(env.APP_ORIGIN){
  const configured=new URL(env.APP_ORIGIN);
  if(!['http:','https:'].includes(configured.protocol)||configured.username||configured.password||configured.pathname!=='/'||configured.search||configured.hash)throw new Error('Invalid APP_ORIGIN');
  return configured.origin;
 }
 const internal=new URL(request.url),host=request.headers.get('host');
 if(!host)return internal.origin;
 if(!/^[a-zA-Z0-9.\-:[\]]+$/.test(host))throw new Error('Invalid Host');
 return new URL((env.VERCEL==='1'?'https:':internal.protocol)+'//'+host).origin;
}
export function checkMutation(request,env={}) {
 const expected=publicOrigin(request,env);
 const origin=request.headers.get('origin');
 if(origin!==expected)return {ok:false,reason:'origin',expected};
 const type=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(type!=='application/json')return {ok:false,reason:'content-type',expected};
 return {ok:true,reason:null,expected};
}
