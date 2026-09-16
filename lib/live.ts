"use client";
import {useEffect,useRef,useState} from 'react';

export type ReauthenticationAttempt={complete:()=>void;cancel:()=>void};
type ReauthenticationHandler=(attempt:ReauthenticationAttempt)=>void;
let reauthenticationHandler:ReauthenticationHandler|null=null;
let pendingReauthentication:Promise<void>|null=null;
let verificationGeneration=0;
let lastVerificationError:Error|null=null;

export function registerReauthentication(handler:ReauthenticationHandler){
 reauthenticationHandler=handler;
 return()=>{if(reauthenticationHandler===handler)reauthenticationHandler=null};
}
function verificationError(message:string,code:string){return Object.assign(new Error(message),{status:428,code})}
function requireReauthentication(observedGeneration:number):Promise<void>{
 // Requests already in flight when the same verification finished share its result.
 if(observedGeneration!==verificationGeneration)return lastVerificationError?Promise.reject(lastVerificationError):Promise.resolve();
 if(pendingReauthentication)return pendingReauthentication;
 if(!reauthenticationHandler)return Promise.reject(verificationError('安全验证窗口尚未准备好，请稍后重试。当前编辑内容仍保留。','reauthentication_unavailable'));
 let resolve!:()=>void,reject!:(error:Error)=>void,settled=false;
 const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no});
 pendingReauthentication=promise;
 const finish=(error:Error|null)=>{
  if(settled)return;settled=true;verificationGeneration++;lastVerificationError=error;
  if(pendingReauthentication===promise)pendingReauthentication=null;
  if(error)reject(error);else resolve();
 };
 try{reauthenticationHandler({complete:()=>finish(null),cancel:()=>finish(verificationError('已取消安全验证，本次操作未提交。当前编辑内容仍保留。','reauthentication_cancelled'))})}
 catch{finish(verificationError('安全验证窗口暂时无法打开，请稍后重试。当前编辑内容仍保留。','reauthentication_unavailable'))}
 return promise;
}

export async function request<T>(path:string,init?:RequestInit):Promise<T>{
 const authRequest=path.startsWith('/api/auth/');
 const codeRequest=authRequest&&path.endsWith('/send/');
 const logoutRequest=/^\/api\/auth\/logout(?:-all)?\/?$/.test(path);
 const membershipWrite=path.startsWith('/api/admin/members/')&&init?.method?.toUpperCase()==='PUT';
 const protectedWrite=path.startsWith('/api/admin/')&&(init?.method||'GET').toUpperCase()!=='GET';
 const observedGeneration=verificationGeneration;
 try{
  for(let attempt=0;attempt<2;attempt++){
   const response=await fetch(path,{cache:'no-store',...init,signal:init?.signal||AbortSignal.timeout(45000)});
   const data=await response.json().catch(()=>null);
   if(protectedWrite&&response.status===428&&data?.code==='reauthentication_required'){
    if(attempt===0){await requireReauthentication(observedGeneration);continue}
    throw verificationError('安全验证状态尚未更新，本次操作未执行。请保留当前内容，稍后重试。','reauthentication_required');
   }
   if(!response.ok)throw Object.assign(new Error(data?.error||(response.status===401?'登录已过期，请重新登录。':`请求失败（${response.status}），请稍后检查。`)),{status:response.status,code:data?.code});
   if(data===null)throw new Error(membershipWrite?'保存结果尚未确认，请刷新会员列表核对后再操作。':authRequest?'登录服务返回异常，请稍后重试。':'服务器返回异常，请先检查内容是否已保存。');
   return data;
  }
  throw new Error('请求未完成，请保留当前内容后重试。');
 }catch(error){
  if(error instanceof DOMException&&['TimeoutError','AbortError'].includes(error.name))throw new Error(membershipWrite?'保存结果尚未确认，请刷新会员列表核对后再操作。':codeRequest?'请求超时。若已收到验证码，可直接填写后提交；否则稍后重试。':logoutRequest?'退出结果尚未确认，请刷新页面检查登录状态。':authRequest?'请求超时，请稍后重试。如果刚才在重置密码，可返回登录页尝试使用新密码。':'请求超时，保存结果尚未确认。请在新窗口检查最新内容，确认未发布后再重试；当前正文已保留。');
  if(error instanceof TypeError)throw new Error(membershipWrite?'网络连接中断，保存结果尚未确认，请刷新会员列表核对后再操作。':logoutRequest?'网络连接中断，退出结果尚未确认，请刷新页面检查登录状态。':authRequest?'网络连接中断，请检查网络后重试。':'网络连接中断，保存结果尚未确认。请先检查最新内容再重试；当前正文已保留。');
  throw error;
 }
}
export function useResource<T>(path:string){const checkedExpiry=useRef('');const [data,setData]=useState<T|null>(null);const [error,setError]=useState('');const [version,setVersion]=useState(0);useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')setVersion(v=>v+1)};window.addEventListener('focus',refresh);if(path==='/api/session')window.addEventListener('research-session-change',refresh);document.addEventListener('visibilitychange',refresh);const membershipChanged=()=>{setData(null);setVersion(v=>v+1)};window.addEventListener('research-membership-change',membershipChanged);return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('research-session-change',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('research-membership-change',membershipChanged)}},[]);useEffect(()=>{if(path!=='/api/session'||!data)return;const member=(data as {membership?:{status:string;expiresAt:string|null}}).membership;if(member?.status!=='active'||!member.expiresAt)return;const remaining=Date.parse(member.expiresAt)-Date.now();if(!Number.isFinite(remaining)||checkedExpiry.current===member.expiresAt)return;const timer=setTimeout(()=>{if(remaining<=2147483547)checkedExpiry.current=member.expiresAt||'';window.dispatchEvent(new Event('research-membership-change'))},Math.max(0,Math.min(remaining+100,2147483647)));return()=>clearTimeout(timer)},[path,data]);useEffect(()=>{let active=true;setError('');request<T>(path).then(d=>{if(active)setData(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[path,version]);return {data,error,retry:()=>setVersion(v=>v+1)};}
