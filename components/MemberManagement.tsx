"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {request,useResource} from '@/lib/live';
import ResourceState from './ResourceState';
import {formatMemberExpiry,membershipLabels,type MemberMembership,type MembershipStatus} from './Membership';

type MemberUser={id:string;email:string;nickname:string;createdAt:string;confirmed:boolean;isAdmin:boolean;membership:MemberMembership};
type MemberPage={users:MemberUser[];page:number;pageSize:number;total:number};
type FilterStatus='all'|MembershipStatus;
function beijingDate(value:Date|string=new Date()){return new Date(value).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}
function expiryForDate(value:string){const date=new Date(value+'T23:59:59+08:00');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&beijingDate(date)===value?date.toISOString():''}
function currentDate(user:MemberUser){return user.membership.expiresAt&&Date.parse(user.membership.expiresAt)>Date.now()?beijingDate(user.membership.expiresAt):''}

export default function MemberManagement(){
 const session=useResource<{signedIn:boolean;isAdmin:boolean}>('/api/session');
 if(!session.data)return <ResourceState error={session.error} retry={session.retry}/>;
 if(!session.data.isAdmin)return <div className="reading"><h1>用户与会员管理</h1><div className="member-status"><p>{session.data.signedIn?'当前账号没有管理权限。':'请先登录管理员账号。'}</p><Link className="button" href="/login/">前往登录</Link></div></div>;
 return <>{session.error&&<p className="notice error" role="alert">登录状态暂时无法刷新，未保存的修改仍保留。{session.error}</p>}<Manager/></>;
}
function Manager(){
 const editPanel=useRef<HTMLElement>(null);
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState<FilterStatus>('all'),[page,setPage]=useState(1),[version,setVersion]=useState(0);
 const [data,setData]=useState<MemberPage|null>(null),[loading,setLoading]=useState(true),[listError,setListError]=useState('');
 const [selected,setSelected]=useState<MemberUser|null>(null),[date,setDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[needsRefresh,setNeedsRefresh]=useState(false);
 const [revokeTarget,setRevokeTarget]=useState<string|null>(null);
 useEffect(()=>{
  let active=true;setLoading(true);setListError('');
  const params=new URLSearchParams({q:query,page:String(page),status});
  request<MemberPage>('/api/admin/members?'+params).then(result=>{if(active){if(page>1&&!result.users.length&&result.total<=((page-1)*result.pageSize)){setPage(Math.max(1,Math.ceil(result.total/result.pageSize)));return}setData(result)}}).catch(e=>{if(active)setListError((e as Error).message)}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[query,status,page,version]);
 function select(user:MemberUser){if(busy)return;setRevokeTarget(null);setSelected(user);setDate(currentDate(user));setError('');setNotice('');setNeedsRefresh(false);if(window.matchMedia('(max-width: 980px)').matches)requestAnimationFrame(()=>editPanel.current?.scrollIntoView({behavior:'smooth',block:'start'}))}
 function clearSelection(){setRevokeTarget(null);setSelected(null);setDate('');setError('');setNotice('');setNeedsRefresh(false)}
 function searchUsers(e:React.FormEvent){e.preventDefault();if(busy)return;setQuery(search.trim());setPage(1);setVersion(v=>v+1);clearSelection()}
 function quickExtend(days:number){if(!selected)return;const expiry=selected.membership.status==='active'?Date.parse(selected.membership.expiresAt||''):0;setDate(beijingDate(new Date(Math.max(Number.isFinite(expiry)?expiry:0,Date.now())+days*86400000)));setError('');setNotice('')}
 async function refreshSelected(){
  if(!selected||busy)return;setRevokeTarget(null);setBusy(true);setError('');setNotice('');
  try{const result=await request<MemberPage>('/api/admin/members?'+new URLSearchParams({q:selected.email,page:'1',status:'all'}));const user=result.users.find(item=>item.id===selected.id);if(!user)throw new Error('未找到该用户，请刷新列表后重新选择。');setSelected(user);setDate(currentDate(user));setNeedsRefresh(false);setVersion(v=>v+1);setNotice('已读取最新会员状态，请重新确认到期日期后保存。')}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function save(action:'set'|'revoke'){
  if(!selected||busy||needsRefresh||!selected.confirmed)return;
  const expiresAt=action==='set'?expiryForDate(date):'';
  if(action==='set'&&(!expiresAt||Date.parse(expiresAt)<=Date.now())){setError('请选择今天或之后的有效到期日期。');return}
  if(action==='revoke'&&revokeTarget!==selected.id)return;
  setBusy(true);setError('');setNotice('');
  try{
   const membership=await request<MemberMembership>('/api/admin/members/'+encodeURIComponent(selected.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(action==='set'?{expiresAt}:{}),revision:selected.membership.revision})});
   if(!membership||!['none','active','expired','revoked'].includes(membership.status)||!Number.isInteger(membership.revision)){setNeedsRefresh(true);throw new Error('保存结果暂时无法确认，请刷新该用户状态后检查。')}
   const updated={...selected,membership};setRevokeTarget(null);setSelected(updated);setDate(currentDate(updated));setVersion(v=>v+1);setNotice(action==='set'?'会员资格已保存，到期时间：'+formatMemberExpiry(membership.expiresAt):'会员资格已撤销。');window.dispatchEvent(new Event('research-session-change'));
  }catch(e){const failure=e as Error&{status?:number};if(failure.status===409){setNeedsRefresh(true);setError((failure.message||'该用户的会员状态已发生变化。')+' 请点击“刷新该用户状态”，确认最新信息后再操作。')}else{if(!failure.status)setNeedsRefresh(true);setError(failure.message)}}finally{setBusy(false)}
 }
 const pages=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
 return <div className="member-management">
  <header className="member-management-heading"><div><div className="eyebrow">MEMBERSHIP ADMIN</div><h1>用户与会员管理</h1><p>查看注册用户，开通、续期或撤销会员资格。</p></div><Link className="button secondary" href="/admin/">返回内容管理</Link></header>
  <form className="member-search" onSubmit={searchUsers}><label>搜索用户<input type="search" placeholder="输入昵称或邮箱" maxLength={100} value={search} disabled={busy} onChange={e=>setSearch(e.target.value)}/></label><label>会员状态<select value={status} disabled={busy} onChange={e=>{setStatus(e.target.value as FilterStatus);setPage(1);clearSelection()}}><option value="all">全部用户</option><option value="active">有效会员</option><option value="expired">已过期</option><option value="none">未开通</option><option value="revoked">已撤销</option></select></label><button className="button" type="submit" disabled={busy}>搜索</button></form>
  <div className="member-management-grid"><section className="member-list-panel" aria-label="用户列表"><div className="member-list-heading"><h2>用户列表</h2>{data&&<span>共 {data.total} 位</span>}</div>
   {loading?<p role="status" className="member-list-message">正在读取用户…</p>:listError?<div className="member-list-message" role="alert"><p>{listError}</p><button className="button secondary" onClick={()=>{setRevokeTarget(null);setVersion(v=>v+1)}} disabled={busy}>重新读取</button></div>:data?.users.length?<div className="member-user-list">{data.users.map(user=><button type="button" key={user.id} className={'member-user-row '+(selected?.id===user.id?'selected':'')} aria-pressed={selected?.id===user.id} disabled={busy} onClick={()=>select(user)}><span className="member-user-identity"><strong>{user.nickname||'未设置昵称'}</strong><span>{user.email}</span><small>{user.isAdmin?'管理员 · ':''}{user.confirmed?'邮箱已验证':'邮箱未验证'}</small></span><span className="member-user-state"><span className={'member-badge '+user.membership.status}>{membershipLabels[user.membership.status]}</span><small>{user.membership.expiresAt?'到期：'+beijingDate(user.membership.expiresAt):'暂无会员期限'}</small><small>管理会员 →</small></span></button>)}</div>:<div className="member-list-message"><p>没有符合条件的用户。</p>{(query||status!=='all')&&<button className="button secondary" disabled={busy} onClick={()=>{setSearch('');setQuery('');setStatus('all');setPage(1);clearSelection()}}>查看全部用户</button>}</div>}
   <div className="member-pagination"><button className="button secondary" disabled={busy||loading||page<=1} onClick={()=>{setPage(v=>v-1);clearSelection()}}>上一页</button><span>第 {page} / {pages} 页</span><button className="button secondary" disabled={busy||loading||!!listError||page>=pages} onClick={()=>{setPage(v=>v+1);clearSelection()}}>下一页</button></div>
  </section><section ref={editPanel} className="member-edit-panel" aria-label="会员资格编辑">{selected?<><h2>管理会员资格</h2><p className="member-selected-name">{selected.nickname||'未设置昵称'}</p><p className="member-selected-email">{selected.email}</p><span className={'member-badge '+selected.membership.status}>{membershipLabels[selected.membership.status]}</span><dl className="member-details"><div><dt>注册时间</dt><dd>{formatMemberExpiry(selected.createdAt)}</dd></div><div><dt>{selected.membership.status==='revoked'?'原到期时间':'当前到期时间'}</dt><dd>{formatMemberExpiry(selected.membership.expiresAt)}</dd></div></dl>{!selected.confirmed&&<p className="notice">该用户尚未验证邮箱，暂不能修改会员资格。</p>}{selected.isAdmin&&<p className="muted">此账号的管理员访问权限不受会员期限影响。</p>}
   <form className="account-form member-expiry-form" onSubmit={e=>{e.preventDefault();void save('set')}}><label>会员到期日期（北京时间）<input type="date" min={beijingDate()} value={date} required disabled={busy||needsRefresh||!selected.confirmed} onChange={e=>{setDate(e.target.value);setError('');setNotice('')}}/></label><small>所选日期当天 23:59:59 到期。修改日期后，点击保存才会生效。</small><div className="member-duration-buttons">{[30,90,365].map(days=><button type="button" className="button secondary" key={days} disabled={busy||needsRefresh||!selected.confirmed} onClick={()=>quickExtend(days)}>＋{days} 天</button>)}</div><small>有效会员从当前到期时间延长；其他用户从今天起算。</small><button className="button" type="submit" disabled={busy||needsRefresh||!selected.confirmed}>{busy?'正在处理…':'保存会员资格'}</button></form>
   <div className="member-edit-actions"><button className="button secondary" disabled={busy} onClick={refreshSelected}>刷新该用户状态</button><button className="button secondary member-revoke" disabled={busy||needsRefresh||!selected.confirmed||revokeTarget===selected.id||['none','revoked'].includes(selected.membership.status)} onClick={()=>{setRevokeTarget(selected.id);setError('');setNotice('')}}>撤销会员</button></div>
   {revokeTarget===selected.id&&<section className="notice member-revoke-confirm" role="group" aria-label="撤销会员确认"><p>确认撤销 <strong>{selected.email}</strong> 的会员资格？</p><div className="actions"><button type="button" className="button secondary member-revoke" disabled={busy||needsRefresh||!selected.confirmed} onClick={()=>save('revoke')}>{busy?'正在处理…':'确认撤销'}</button><button type="button" className="button secondary" disabled={busy} onClick={()=>setRevokeTarget(null)}>取消</button></div></section>}
   {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  </>:<div className="member-list-message"><h2>选择一位用户</h2><p>点击左侧用户，查看会员状态并设置到期日期。</p><small>手机上可先选择用户，再向下查看编辑区。</small></div>}</section></div>
 </div>;
}
