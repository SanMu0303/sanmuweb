"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {request,useResource} from '@/lib/live';

export default function AdminLogin({register=false,resetPassword=false}:{register?:boolean;resetPassword?:boolean}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [busy,setBusy]=useState<'send'|'submit'|'logout'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[remaining,setRemaining]=useState(0);
 const emailInput=useRef<HTMLInputElement>(null),passwordInput=useRef<HTMLInputElement>(null);
 const session=useResource<{signedIn:boolean;isAdmin:boolean;nickname:string}>('/api/session');
 const needsCode=register||resetPassword;

 useEffect(()=>{if(!remaining)return;const timer=window.setTimeout(()=>setRemaining(value=>Math.max(0,value-1)),1000);return()=>window.clearTimeout(timer)},[remaining]);
 useEffect(()=>{
  if(location.hash){history.replaceState(null,'',location.pathname+location.search);setNotice('邮箱链接登录已停用，请使用邮箱和密码。未设置密码的账号可通过“忘记密码”设置密码。')}
  else if(!register&&!resetPassword&&new URLSearchParams(location.search).get('reset')==='1')setNotice('密码已重置，请使用新密码登录。');
 },[register,resetPassword]);

 function changeEmail(value:string){setEmail(value);setCode('');setError('');setNotice('')}

 async function sendCode(){
  if(busy||remaining||!emailInput.current?.reportValidity())return;
  if(register&&!passwordInput.current?.reportValidity())return;
  setError('');setNotice('');setBusy('send');setRemaining(60);
  const address=email.trim().toLowerCase();
  try{
   const result=await request<{retryAfter:number}>(resetPassword?'/api/auth/password/send/':'/api/auth/register/send/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(resetPassword?{email:address}:{email:address,password})});
   setCode('');setRemaining(Math.max(60,result.retryAfter||60));
   setNotice(resetPassword?'如果该邮箱已注册，你会收到重置密码的验证码。请查看收件箱和垃圾邮件。':'如该邮箱尚未完成注册，验证码会发送到邮箱。若已注册，请直接登录或使用忘记密码。');
  }catch(e){setError((e as Error).message)}finally{setBusy(null)}
 }

 async function submit(e:React.FormEvent){
  e.preventDefault();if(busy)return;setError('');setNotice('');setBusy('submit');
  const address=email.trim().toLowerCase();
  try{
   const path=resetPassword?'/api/auth/password/reset/':register?'/api/auth/register/':'/api/auth/login/';
   const result=await request<{isAdmin?:boolean;passwordReset?:boolean}>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:address,password,...(needsCode?{code}:{})})});
   setPassword('');setCode('');
   const requested=new URLSearchParams(location.search).get('returnTo')||'';
   const returnTo=requested.startsWith('/')&&!requested.startsWith('//')?requested:'';
   window.location.assign(resetPassword?'/login/?reset=1':returnTo||(result.isAdmin?'/admin/':'/profile/'));
  }catch(e){setError((e as Error).message);setBusy(null)}
 }

 async function logout(){setBusy('logout');setError('');try{await request('/api/auth/logout/',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});window.location.assign('/login/')}catch(e){setError((e as Error).message);setBusy(null)}}

 return <div className="member-status">
  <h2>{resetPassword?'重置密码':register?'邮箱注册':'邮箱密码登录'}</h2>
  {session.data?.signedIn&&!resetPassword?<>
   <p>你好，{session.data.nickname}</p>
   <div className="actions"><Link className="button" href="/profile/">个人中心</Link>{session.data.isAdmin&&<Link className="button secondary" href="/admin/">内容管理</Link>}<button className="button secondary" onClick={logout} disabled={!!busy}>退出登录</button></div>
  </>:<>
   <p>{resetPassword?'通过邮箱验证码设置新密码，完成后返回登录。':register?'填写邮箱和密码，验证邮箱后完成注册。':'使用注册邮箱和密码登录。'}</p>
   <form onSubmit={submit} className="account-form">
    <label>邮箱<input ref={emailInput} name="email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={!!busy} onChange={e=>changeEmail(e.target.value)}/></label>
    <label>{resetPassword?'新密码':'密码'}<input ref={passwordInput} name="password" type="password" autoComplete={needsCode?'new-password':'current-password'} required minLength={needsCode?8:undefined} maxLength={needsCode?72:1024} aria-describedby={needsCode?'password-help':undefined} value={password} disabled={!!busy} onChange={e=>setPassword(e.target.value)}/></label>
    {needsCode&&<>
     <small id="password-help">密码长度为 8–72 个字符。</small>
     <label>邮箱验证码<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="输入邮件中的 6 位数字验证码" value={code} disabled={!!busy} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
     <button type="button" className="button secondary" disabled={!!busy||remaining>0} onClick={sendCode}>{busy==='send'?'正在发送…':remaining>0?`${remaining}秒后重新发送`:'获取验证码'}</button>
     <small>请填写最新邮件中的 6 位验证码，已收到验证码可直接提交。</small>
    </>}
    <button className="button" type="submit" disabled={!!busy}>{busy==='submit'?(resetPassword?'正在重置…':register?'正在注册…':'正在登录…'):(resetPassword?'重置密码':register?'注册':'登录')}</button>
    {!needsCode&&<small><Link href="/forgot-password/">忘记密码</Link></small>}
   </form>
   <p>{resetPassword?<Link href="/login/">返回登录</Link>:register?<>已有账号？<Link href="/login/">去登录</Link></>:<>还没有账号？<Link href="/register/">去注册</Link></>}</p>
  </>}
  {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 </div>;
}
