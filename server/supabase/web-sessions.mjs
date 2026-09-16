// Server-only session storage. Browser cookies contain only a random lookup secret.
import {createHash,randomBytes} from 'node:crypto';
import {configuration} from './client.mjs';

export const SESSION_SECONDS=30*24*60*60;
export const REAUTH_SECONDS=15*60;
export const sessionHash=token=>createHash('sha256').update(token).digest('hex');
export const newSessionToken=()=>randomBytes(32).toString('hex');
export function sessionToken(request){
 const values=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith('research_session='));
 if(values.length!==1)return '';
 const token=values[0].slice('research_session='.length);
 return /^[a-f0-9]{64}$/.test(token)?token:'';
}
export function createWebSessions(env=process.env,transport=fetch){
 const {url,key}=configuration(env);
 async function rpc(name,body){
  const response=await transport(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,...(!key.startsWith('sb_secret_')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){
   const error=await response.json().catch(()=>({}));
   const conflict=error.code==='PT409';
   throw Object.assign(new Error(conflict?'登录状态已变化，请重新登录。':'登录服务暂时不可用，请稍后重试。'),{status:conflict?409:503});
  }
  return response.status===204?null:response.json();
 }
 return {
  begin:email=>rpc('begin_web_login',{p_email:email}),
  create:(hash,userId,sessionId,tokens,epoch)=>rpc('create_web_session',{p_token_hash:hash,p_user_id:userId,p_auth_session_id:sessionId,p_access_token:tokens.token,p_refresh_token:tokens.refreshToken,p_access_expires_at:tokens.expiresAt,p_epoch:epoch}),
  resolve:(hash,owner)=>rpc('resolve_web_session',{p_token_hash:hash,p_refresh_owner:owner}),
  finish:(hash,owner,version,tokens)=>rpc('finish_web_session_refresh',{p_token_hash:hash,p_refresh_owner:owner,p_version:version,p_access_token:tokens.token,p_refresh_token:tokens.refreshToken,p_access_expires_at:tokens.expiresAt}),
  release:(hash,owner,version)=>rpc('release_web_session_refresh',{p_token_hash:hash,p_refresh_owner:owner,p_version:version}),
  revoke:hash=>rpc('revoke_web_session',{p_token_hash:hash}),
  revokeAll:userId=>rpc('revoke_user_web_sessions',{p_user_id:userId}),
  reauthenticate:(hash,userId)=>rpc('mark_web_session_reauthenticated',{p_token_hash:hash,p_user_id:userId}),
 };
}
