"use client";
import Link from 'next/link';
import {useResource} from '@/lib/live';
import ResourceState from './ResourceState';

export type MembershipStatus='none'|'active'|'expired'|'revoked';
export type MemberMembership={status:MembershipStatus;expiresAt:string|null;revision:number};
export type MemberSession={signedIn:boolean;isAdmin:boolean;isMember:boolean;nickname:string;membership?:MemberMembership};
export const membershipLabels:Record<MembershipStatus,string>={none:'未开通',active:'有效会员',expired:'会员已过期',revoked:'会员已撤销'};
export function formatMemberExpiry(value:string|null|undefined){
 if(!value||!Number.isFinite(Date.parse(value)))return '未设置';
 return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))+'（北京时间）';
}
export function MemberStatusSummary({user}:{user:MemberSession}){
 const status=user.membership?.status||'none';
 return <div className="member-account-summary"><span className={'member-badge '+(user.isAdmin?'admin':status)}>{user.isAdmin?'管理员':membershipLabels[status]}</span>{user.isAdmin?<p>管理员可查看全部研究和课程内容。</p>:user.membership?.expiresAt?<p>{status==='revoked'?'原到期时间':'到期时间'}：{formatMemberExpiry(user.membership.expiresAt)}</p>:<p>当前可阅读公开内容及会员内容预览。</p>}</div>;
}
export default function Membership(){
 const session=useResource<MemberSession>('/api/session');
 if(!session.data||session.error)return <ResourceState error={session.error} retry={session.retry}/>;
 const user=session.data,status=user.membership?.status||'none',hasAccess=user.isAdmin||user.isMember;
 return <div className="membership"><div className="page-heading"><div><div className="eyebrow">MEMBERSHIP</div><h1>会员中心</h1><p>持续研究，随时回看。</p></div></div>
  <section className="member-status">
   {user.signedIn?<><h2>{user.nickname}，你好</h2><MemberStatusSummary user={user}/></>:<><span className="member-badge none">访客</span><h2 className="member-card-title">登录后查看会员状态</h2><p>注册账号后可以保存个人资料，也可以查看会员开通方式。</p></>}
   <h3 className="member-card-title">{hasAccess?'你可以阅读':'会员权益'}</h3>
   <ul><li>完整阅读会员研究文章与市场复盘</li><li>观看已发布的会员视频与课程</li><li>回看研究记录、趋势观察和方法案例</li></ul>
   {!hasAccess&&<div className="notice">{!user.signedIn?'点击“开通会员”查看开通方式，登录后可查看自己的会员状态。':status==='expired'?'会员已到期，可前往开通页面了解续期方式；公开内容仍可阅读。':status==='revoked'?'会员资格已撤销。如需重新开通，可前往开通页面查看说明；公开内容仍可阅读。':'当前账号尚未开通会员，可前往开通页面查看说明。注册账号不会自动解锁会员内容。'}</div>}
   <div className="actions membership-entry-actions"><Link className="button membership-subscribe-button" href="/membership/subscribe/">开通会员</Link>{user.signedIn?<><Link className="button secondary" href="/knowledge/">{hasAccess?'进入知识库':'浏览公开课程'}</Link><Link className="button secondary" href="/profile/">个人中心</Link>{user.isAdmin&&<Link className="button secondary" href="/admin/members/">管理用户与会员</Link>}</>:<><Link className="button secondary" href="/login/">登录账号</Link><Link className="button secondary" href="/register/">注册账号</Link><Link href="/knowledge/">先读公开课程 ↗</Link></>}</div>
  </section>
 </div>;
}
