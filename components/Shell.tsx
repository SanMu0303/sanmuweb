"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {useResource} from '@/lib/live';
import {Activity,BookOpen,Compass,NotebookPen,ArrowUpRight,UserRound,Menu,X,LineChart} from 'lucide-react';
import {readSiteTheme,writeSiteTheme,type SiteTheme} from '@/components/site-theme';
const nav=[['/','最新内容',Compass],['/watchlist/','趋势观察池',Activity],['/terminal/','交易终端',LineChart],['/reviews/','市场复盘',NotebookPen],['/knowledge/','知识库 / 课程',BookOpen]] as const;
function isNavActive(path:string,href:string){
 const normalize=(value:string)=>value.length>1?value.replace(/\/+$/,''):value;
 const current=normalize(path),target=normalize(href);
 return target==='/'?current==='/':current===target||current.startsWith(target+'/');
}
function NavigationContent({path}:{path:string}){const session=useResource<{isAdmin:boolean;signedIn:boolean;nickname:string;avatarUrl:string}>('/api/session');return <>
 <div className="sidebar-heading"><strong>研究工作台</strong></div>
 <nav aria-label="研究栏目">{nav.map(([href,label,Icon])=>{const active=isNavActive(path,href);return <Link key={href} href={href} className={active?'active':''} aria-current={active?'page':undefined}><Icon size={18}/><span>{label}</span></Link>})}</nav>
 <div className="side-note"><span className="eyebrow">THE PROCESS MATTERS</span><p>观察。等待。执行。<br/>让每一次判断都有迹可循。</p><div className="rule"/><small>专注趋势，保持耐心。</small></div>
 <div className="sidebar-account-links">
  <Link className="member-nav" href="/membership/"><UserRound size={18}/><span>会员中心</span><ArrowUpRight size={15}/></Link>
  {session.data?.signedIn&&<Link href="/profile/" className={'admin-entry '+(isNavActive(path,'/profile/')?'active':'')} aria-current={isNavActive(path,'/profile/')?'page':undefined}><UserRound size={17}/><span>个人中心</span></Link>}
  {session.data?.isAdmin&&<Link href="/admin/" className={'admin-entry '+(isNavActive(path,'/admin/')?'active':'')} aria-current={isNavActive(path,'/admin/')?'page':undefined}><NotebookPen size={17}/><span>内容管理</span></Link>}
 </div>
 <div className="side-bottom">SANMU / 三木的研究空间</div>
 </>}
export default function Shell({children}:{children:React.ReactNode}){
 const path=usePathname();const session=useResource<{isAdmin:boolean;signedIn:boolean;nickname:string;avatarUrl:string}>('/api/session');const drawer=useRef<HTMLDialogElement>(null);const [open,setOpen]=useState(false);const [theme,setTheme]=useState<SiteTheme>('soft');
 useEffect(()=>setTheme(readSiteTheme()),[]);
 const toggleTheme=()=>{const next:SiteTheme=theme==='soft'?'dark':'soft';setTheme(next);writeSiteTheme(next)};
 function close(){drawer.current?.close();setOpen(false)}
 useEffect(()=>{drawer.current?.close();setOpen(false)},[path]);
 useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const media=matchMedia('(min-width: 761px)');const resize=()=>{if(media.matches){drawer.current?.close();setOpen(false)}};media.addEventListener('change',resize);return()=>{document.body.style.overflow=previous;media.removeEventListener('change',resize)}},[open]);
 return <div className={`site-shell site-shell--${theme}`} data-theme={theme}><aside className="sidebar"><NavigationContent path={path}/></aside><dialog ref={drawer} id="mobile-navigation" className="mobile-drawer" aria-label="研究空间导航" onClose={()=>setOpen(false)} onClick={e=>{if(e.target===e.currentTarget)close()}}><div className="drawer-content" onClick={e=>{if((e.target as HTMLElement).closest('a'))close()}}><button className="drawer-close" onClick={close} aria-label="关闭导航"><X size={22}/></button><NavigationContent path={path}/></div></dialog><div className="workspace"><header className="topbar"><div className="topbar-location"><button className="mobile-menu-toggle" aria-label="打开导航" aria-expanded={open} aria-controls="mobile-navigation" onClick={()=>{drawer.current?.showModal();setOpen(true)}}><Menu size={22}/></button><Link href="/" className="site-topbar-brand" aria-label="三木趋势首页"><span className="site-topbar-mark">三</span><span><strong>三木趋势</strong><small>RESEARCH JOURNAL</small></span></Link><span className="site-topbar-meta"><span className="site-live-dot"/>研究空间 · 持续记录</span></div><div className="account-links"><button type="button" className="site-theme-toggle" aria-pressed={theme==='dark'} onClick={toggleTheme} title="切换界面风格"><span aria-hidden="true">{theme==='soft'?'☾':'☼'}</span>{theme==='soft'?'暗色风格':'柔和亮面'}</button>{session.data?.signedIn?<Link className="account-identity" href="/profile/" aria-label="打开个人中心">{session.data.avatarUrl?<img src={session.data.avatarUrl} alt="我的头像"/>:<span className="account-initial">{session.data.nickname?.slice(0,1)||'研'}</span>}<span>{session.data.nickname||'研究员'}</span></Link>:<><Link href="/login/">登录</Link><Link className="login-pill" href="/register/">注册账号 ↗</Link></>}</div></header><main>{children}</main><footer><span>趋势交易观察室 © 2026</span><span>持续记录 · 独立判断 · 非实时行情</span></footer></div></div>}
