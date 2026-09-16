"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {request,useResource} from '@/lib/live';
export default function AdminLogin({register=false}:{register?:boolean}){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sentTo,setSentTo]=useState('');
 const [busy,setBusy]=useState<'send'|'verify'|'logout'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[remaining,setRemaining]=useState(0);
 const session=useResource<{signedIn:boolean;isAdmin:boolean;nickname:string}>('/api/session');
 useEffect(()=>{if(!remaining)return;const timer=window.setTimeout(()=>setRemaining(value=>Math.max(0,value-1)),1000);return()=>window.clearTimeout(timer)},[remaining]);
 useEffect(()=>{if(location.hash){history.replaceState(null,'',location.pathname+location.search);setNotice('请在此获取邮箱验证码完成登录。')}},[]);
 async function sendCode(e?:React.FormEvent){
  e?.preventDefault();if(busy||remaining)return;setError('');setNotice('');setBusy('send');
  const address=email.trim().toLowerCase();
  try{const result=await request<{retryAfter:number}>('/api/auth/otp/send/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:address})});setSentTo(address);setCode('');setRemaining(result.retryAfter||60);setNotice('验证码已发送，请查看收件箱；如未收到，也请检查垃圾邮件。')}
  catch(e){setError((e as Error).message)}finally{setBusy(null)}
 }
 async function verify(e:React.FormEvent){
  e.preventDefault();if(busy)return;setError('');setNotice('');setBusy('verify');
  try{const result=await request<{isAdmin:boolean}>('/api/auth/otp/verify/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:sentTo||email.trim().toLowerCase(),code})});setCode('');window.location.assign(result.isAdmin?'/admin/':'/profile/')}
  catch(e){setError((e as Error).message);setBusy(null)}
 }
 async function logout(){setBusy('logout');setError('');try{await request('/api/auth/logout/',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});window.location.assign('/login/')}catch(e){setError((e as Error).message);setBusy(null)}}
 return <div className="member-status"><h2>{register?'邮箱验证注册 / 登录':'邮箱验证码登录'}</h2>{session.data?.signedIn?<><p>你好，{session.data.nickname}</p><div className="actions"><Link className="button" href="/profile/">个人中心</Link>{session.data.isAdmin&&<Link className="button secondary" href="/admin/">内容管理</Link>}<button className="button secondary" onClick={logout} disabled={!!busy}>退出登录</button></div></>:<>
  <p>无需密码，首次验证邮箱后自动创建账号。</p>
  {!sentTo?<form onSubmit={sendCode} className="account-form"><label>邮箱<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={!!busy} onChange={e=>setEmail(e.target.value)}/></label><button className="button" disabled={!!busy||remaining>0}>{busy==='send'?'正在发送…':remaining>0?`${remaining}秒后可发送`:'获取验证码'}</button><button type="button" className="button secondary" disabled={!!busy||!email.trim()} onClick={()=>{setSentTo(email.trim().toLowerCase());setError('');setNotice('请输入此邮箱收到的验证码。')}}>已有验证码</button></form>:<form onSubmit={verify} className="account-form"><p>验证码已发送至 <strong>{sentTo}</strong></p><label>邮箱验证码<input type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="[0-9]{6,8}" minLength={6} maxLength={8} placeholder="输入邮件中的数字验证码" value={code} disabled={!!busy} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label><button className="button" disabled={!!busy}>{busy==='verify'?'正在验证…':'验证并登录'}</button><div className="actions"><button type="button" className="button secondary" disabled={!!busy||remaining>0} onClick={()=>sendCode()}>{busy==='send'?'正在发送…':remaining>0?`${remaining}秒后重新发送`:'重新发送验证码'}</button><button type="button" className="button secondary" disabled={!!busy} onClick={()=>{setSentTo('');setCode('');setError('');setNotice('')}}>更换邮箱</button></div><small>请输入最新邮件中的验证码。登录后可在个人中心设置昵称。</small></form>}
 </>}{error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}</div>;
}
