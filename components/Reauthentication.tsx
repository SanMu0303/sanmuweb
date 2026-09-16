"use client";
import {useEffect,useRef,useState} from 'react';
import {registerReauthentication,request,type ReauthenticationAttempt} from '@/lib/live';

export default function Reauthentication(){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),previousFocus=useRef<HTMLElement|null>(null),pending=useRef<ReauthenticationAttempt|null>(null),nativeAttempt=useRef<ReauthenticationAttempt|null>(null),controller=useRef<AbortController|null>(null);
 const [open,setOpen]=useState(false),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const unregister=registerReauthentication(attempt=>{previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;pending.current=attempt;setPassword('');setError('');setBusy(false);setOpen(true)});
  return()=>{unregister();controller.current?.abort();pending.current?.cancel();pending.current=null};
 },[]);
 useEffect(()=>{
  if(open){nativeAttempt.current=pending.current;if(!dialog.current?.open)dialog.current?.showModal();const frame=requestAnimationFrame(()=>input.current?.focus());return()=>cancelAnimationFrame(frame)}
  if(dialog.current?.open){dialog.current.close();const target=previousFocus.current;requestAnimationFrame(()=>{
   if(target?.isConnected&&target!==document.body){target.focus({preventScroll:true});if(document.activeElement===target)return}
   // A saving form can still be disabled while its verified request finishes.
   const fallback=document.querySelector<HTMLElement>('main');if(!fallback)return;
   const prior=fallback.getAttribute('tabindex');fallback.setAttribute('tabindex','-1');fallback.focus({preventScroll:true});
   fallback.addEventListener('blur',()=>{if(prior===null)fallback.removeAttribute('tabindex');else fallback.setAttribute('tabindex',prior)},{once:true});
  })}
 },[open]);
 function cancel(){const attempt=pending.current;if(!attempt)return;pending.current=null;controller.current?.abort();controller.current=null;setPassword('');setBusy(false);setError('');setOpen(false);attempt.cancel()}
 async function verify(e:React.FormEvent){
  e.preventDefault();const attempt=pending.current;if(!attempt||controller.current||!password)return;
  const submission=new AbortController();controller.current=submission;const submittedPassword=password;setPassword('');setError('');setBusy(true);
  const timeout=window.setTimeout(()=>submission.abort(new DOMException('安全验证请求超时','TimeoutError')),45000);
  try{
   const result=await request<{verified:boolean;reauthenticatedUntil:string}>('/api/auth/reauth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:submittedPassword}),signal:submission.signal});
   if(pending.current!==attempt||submission.signal.aborted)return;
   if(!result.verified)throw new Error('密码验证未完成，请重新输入密码。');
   pending.current=null;setOpen(false);setBusy(false);attempt.complete();
  }catch(e){if(pending.current===attempt&&!submission.signal.aborted){setError((e as Error).message);requestAnimationFrame(()=>input.current?.focus())}else if(pending.current===attempt){setError('安全验证请求超时，请重新输入密码后重试。');requestAnimationFrame(()=>input.current?.focus())}}
  finally{window.clearTimeout(timeout);if(controller.current===submission)controller.current=null;if(pending.current===attempt)setBusy(false)}
 }
 return <dialog ref={dialog} className="reauth-dialog" aria-labelledby="reauth-title" aria-describedby="reauth-description" onCancel={e=>{e.preventDefault();cancel()}} onClose={()=>{if(!dialog.current?.open&&pending.current&&pending.current===nativeAttempt.current)cancel()}}>
  <form onSubmit={verify} className="reauth-form"><h2 id="reauth-title">验证管理员密码</h2><p id="reauth-description">请再次输入当前账号的密码。验证成功后会继续刚才的操作；取消后，编辑内容仍会保留。</p><label htmlFor="reauth-password">当前密码</label><input ref={input} id="reauth-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/>{error&&<p className="notice error" role="alert">{error}</p>}<div className="actions"><button className="button" type="submit" disabled={busy}>{busy?'正在验证…':'验证并继续'}</button><button className="button secondary" type="button" onClick={cancel}>取消本次操作</button></div></form>
 </dialog>;
}
