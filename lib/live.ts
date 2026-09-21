"use client";
import {useEffect,useRef,useState} from 'react';

export async function request<T>(path:string,init?:RequestInit):Promise<T>{
 const authRequest=path.startsWith('/api/auth/');
 const codeRequest=authRequest&&path.endsWith('/send/');
 const logoutRequest=/^\/api\/auth\/logout(?:-all)?\/?$/.test(path);
 const membershipWrite=path.startsWith('/api/admin/members/')&&init?.method?.toUpperCase()==='PUT';
 try{
  // Submit once: a failed response may follow a successful write, so automatic
  // replay could publish or save the same operation twice.
  const response=await fetch(path,{...init,cache:'no-store',signal:init?.signal||AbortSignal.timeout(45000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(data?.error||(response.status===401?'登录已过期，请重新登录。':`请求失败（${response.status}），请稍后检查。`)),{status:response.status,code:data?.code});
  if(data===null)throw new Error(membershipWrite?'保存结果尚未确认，请刷新会员列表核对后再操作。':authRequest?'登录服务返回异常，请稍后重试。':'服务器返回异常，请先检查内容是否已保存。');
  return data;
 }catch(error){
  if(error instanceof DOMException&&['TimeoutError','AbortError'].includes(error.name))throw new Error(membershipWrite?'保存结果尚未确认，请刷新会员列表核对后再操作。':codeRequest?'请求超时。若已收到验证码，可直接填写后提交；否则稍后重试。':logoutRequest?'退出结果尚未确认，请刷新页面检查登录状态。':authRequest?'请求超时，请稍后重试。如果刚才在重置密码，可返回登录页尝试使用新密码。':'请求超时，保存结果尚未确认。请在新窗口检查最新内容，确认未发布后再重试；当前正文已保留。');
  if(error instanceof TypeError)throw new Error(membershipWrite?'网络连接中断，保存结果尚未确认，请刷新会员列表核对后再操作。':logoutRequest?'网络连接中断，退出结果尚未确认，请刷新页面检查登录状态。':authRequest?'网络连接中断，请检查网络后重试。':'网络连接中断，保存结果尚未确认。请先检查最新内容再重试；当前正文已保留。');
  throw error;
 }
}
export function useResource<T>(path:string){const checkedExpiry=useRef('');const [data,setData]=useState<T|null>(null);const [error,setError]=useState('');const [version,setVersion]=useState(0);useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')setVersion(v=>v+1)};window.addEventListener('focus',refresh);if(path==='/api/session')window.addEventListener('research-session-change',refresh);document.addEventListener('visibilitychange',refresh);const membershipChanged=()=>{setData(null);setVersion(v=>v+1)};window.addEventListener('research-membership-change',membershipChanged);return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('research-session-change',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('research-membership-change',membershipChanged)}},[]);useEffect(()=>{if(path!=='/api/session'||!data)return;const member=(data as {membership?:{status:string;expiresAt:string|null}}).membership;if(member?.status!=='active'||!member.expiresAt)return;const remaining=Date.parse(member.expiresAt)-Date.now();if(!Number.isFinite(remaining)||checkedExpiry.current===member.expiresAt)return;const timer=setTimeout(()=>{if(remaining<=2147483547)checkedExpiry.current=member.expiresAt||'';window.dispatchEvent(new Event('research-membership-change'))},Math.max(0,Math.min(remaining+100,2147483647)));return()=>clearTimeout(timer)},[path,data]);useEffect(()=>{let active=true;setError('');request<T>(path).then(d=>{if(active)setData(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[path,version]);return {data,error,retry:()=>setVersion(v=>v+1)};}
