"use client";
import {useState} from 'react';
import {request,useResource} from '@/lib/live';
export default function AdminLogin(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const session=useResource<{signedIn:boolean;email:string}>('/api/session');
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});window.location.assign('/admin/')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function logout(){setBusy(true);setError('');try{await request('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});window.location.assign('/login/')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="member-status"><h2>管理员登录</h2>{session.data?.signedIn?<><p>当前账号：{session.data.email}</p><button className="button" onClick={logout} disabled={busy}>退出登录</button><a className="button" href="/admin/">进入内容管理</a></>:<form onSubmit={login}><p>使用网站管理员邮箱与网站登录密码。</p><label style={{display:'block',margin:'16px 0'}}>邮箱<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} style={{display:'block',width:'100%',padding:10}}/></label><label style={{display:'block',margin:'16px 0'}}>密码<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} style={{display:'block',width:'100%',padding:10}}/></label><button className="button" disabled={busy}>{busy?'正在验证…':'登录'}</button></form>}{error&&<p role="alert">{error}</p>}</div>;
}
