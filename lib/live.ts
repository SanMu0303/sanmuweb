"use client";
import {useEffect,useState} from 'react';
export async function request<T>(path:string,init?:RequestInit):Promise<T>{
 const authRequest=path.startsWith('/api/auth/');
 try{
  const response=await fetch(path,{cache:'no-store',...init,signal:init?.signal||AbortSignal.timeout(45000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.error||(response.status===401?'登录已过期，请重新登录。':`请求失败（${response.status}），请稍后检查。`));
  if(data===null)throw new Error(authRequest?'登录服务返回异常，请稍后重试。':'服务器返回异常，请先检查内容是否已保存。');
  return data;
 }catch(error){if(error instanceof DOMException&&['TimeoutError','AbortError'].includes(error.name))throw new Error(authRequest?'请求超时。若已收到验证码，请直接输入验证；否则稍后重试。':'请求超时，保存结果尚未确认。请在新窗口检查最新内容，确认未发布后再重试；当前正文已保留。');if(error instanceof TypeError)throw new Error(authRequest?'网络连接中断，请检查网络后重试。':'网络连接中断，保存结果尚未确认。请先检查最新内容再重试；当前正文已保留。');throw error}
}
export function useResource<T>(path:string){const [data,setData]=useState<T|null>(null);const [error,setError]=useState('');const [version,setVersion]=useState(0);useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')setVersion(v=>v+1)};window.addEventListener('focus',refresh);if(path==='/api/session')window.addEventListener('research-session-change',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('research-session-change',refresh);document.removeEventListener('visibilitychange',refresh)}},[]);useEffect(()=>{let active=true;setError('');request<T>(path).then(d=>{if(active)setData(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[path,version]);return {data,error,retry:()=>setVersion(v=>v+1)};}
