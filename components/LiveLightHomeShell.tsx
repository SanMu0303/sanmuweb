"use client";

import Link from "next/link";
import {useEffect, useState} from "react";
import {Activity, ArrowUpRight, BookOpen, Compass, LineChart, NotebookPen, UserRound} from "lucide-react";
import {useResource} from "@/lib/live";
import {readSiteTheme, writeSiteTheme, type SiteTheme} from "@/components/site-theme";

const navigation = [
  ["/", "最新内容", Compass],
  ["/watchlist/", "趋势观察池", Activity],
  ["/terminal/", "交易终端", LineChart],
  ["/reviews/", "市场复盘", NotebookPen],
  ["/knowledge/", "知识库 / 课程", BookOpen],
] as const;

export default function LiveLightHomeShell({children}: {children: React.ReactNode}) {
  const session = useResource<{signedIn?: boolean; isAdmin?: boolean; nickname?: string; avatarUrl?: string}>("/api/session");
  const [theme, setTheme] = useState<SiteTheme>("soft");

  useEffect(() => setTheme(readSiteTheme()), []);
  const toggleTheme = () => {
    const next: SiteTheme = theme === "soft" ? "dark" : "soft";
    setTheme(next);
    writeSiteTheme(next);
  };

  return <div className={`light-home-live${theme === "dark" ? " light-home-live--dark" : ""}`} data-theme={theme}>
    <header className="light-home-topbar">
      <Link href="/" className="light-home-brand" aria-label="三木趋势首页">
        <span className="light-home-mark">三</span>
        <span><strong>三木趋势</strong><small>RESEARCH JOURNAL</small></span>
      </Link>
      <div className="light-home-topbar-meta"><span className="light-home-live-dot"/>研究空间 · 持续记录</div>
      <div className="light-home-account">
        <button type="button" className="light-home-theme-toggle" aria-pressed={theme === "dark"} onClick={toggleTheme} title="切换界面风格">
          <span aria-hidden="true">{theme === "soft" ? "☾" : "☼"}</span>{theme === "soft" ? "暗色风格" : "柔和亮面"}
        </button>
        {session.data?.signedIn ? <Link href="/profile/" className="light-home-account-link">
          {session.data.avatarUrl ? <img src={session.data.avatarUrl} alt=""/> : <span className="light-home-account-initial">{session.data.nickname?.slice(0, 1) || "研"}</span>}
          <span>{session.data.nickname || "个人中心"}</span>
        </Link> : <><Link href="/login/">登录</Link><Link className="light-home-login" href="/register/">注册 ↗</Link></>}
      </div>
    </header>
    <div className="light-home-body">
      <aside className="light-home-sidebar" aria-label="研究空间导航">
        <div className="light-home-sidebar-title">研究工作台</div>
        <nav>{navigation.map(([href, label, Icon], index) => <Link key={href} href={href} className={index === 0 ? "active" : undefined} aria-current={index === 0 ? "page" : undefined}><Icon size={16}/><span>{label}</span></Link>)}</nav>
        <div className="light-home-sidebar-note"><span>THE PROCESS MATTERS</span><p>观察。等待。执行。<br/>让每一次判断都有迹可循。</p><i/></div>
        <div className="light-home-account-links" aria-label="账户入口">
          <Link className="light-home-member-link" href="/membership/"><UserRound size={16}/><span>会员中心</span><ArrowUpRight size={14}/></Link>
          {session.data?.signedIn && <Link className="light-home-account-sub-link" href="/profile/"><UserRound size={16}/><span>个人中心</span><ArrowUpRight size={13}/></Link>}
          {session.data?.isAdmin && <Link className="light-home-account-sub-link" href="/admin/"><NotebookPen size={16}/><span>内容管理</span><ArrowUpRight size={13}/></Link>}
        </div>
        <div className="light-home-sidebar-foot"><span className="light-home-live-dot"/>{theme === "dark" ? "暗色界面已启用" : "柔和亮面已启用"}</div>
      </aside>
      <main className="light-home-main">{children}</main>
    </div>
    <div className="light-home-mobile-nav" aria-label="移动端导航">{navigation.slice(0, 4).map(([href, label, Icon], index) => <Link key={href} href={href} className={index === 0 ? "active" : undefined}><Icon size={15}/><span>{label}</span></Link>)}</div>
    <div className="light-home-footer"><span>趋势交易观察室 © 2026</span><span>持续记录 · 独立判断 · 非实时行情</span></div>
  </div>;
}
