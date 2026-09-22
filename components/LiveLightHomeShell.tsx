"use client";

import Link from "next/link";
import {useEffect, useState} from "react";
import {Activity, BookOpen, Compass, LineChart, NotebookPen, UserRound} from "lucide-react";
import {useResource} from "@/lib/live";

type Theme = "airy" | "classic";

const navigation = [
  ["/", "最新内容", Compass],
  ["/watchlist/", "趋势观察池", Activity],
  ["/terminal/", "交易终端", LineChart],
  ["/reviews/", "市场复盘", NotebookPen],
  ["/knowledge/", "知识库 / 课程", BookOpen],
] as const;

function readTheme(): Theme {
  if (typeof window === "undefined") return "airy";
  return new URLSearchParams(window.location.search).get("theme") === "classic" ? "classic" : "airy";
}

function writeTheme(theme: Theme) {
  const url = new URL(window.location.href);
  if (theme === "airy") url.searchParams.delete("theme");
  else url.searchParams.set("theme", theme);
  window.history.replaceState({}, "", url);
}

export default function LiveLightHomeShell({children}: {children: React.ReactNode}) {
  const session = useResource<{signedIn?: boolean; nickname?: string; avatarUrl?: string}>("/api/session");
  const [theme, setTheme] = useState<Theme>("airy");

  useEffect(() => setTheme(readTheme()), []);
  const toggleTheme = () => {
    const next: Theme = theme === "airy" ? "classic" : "airy";
    setTheme(next);
    writeTheme(next);
  };

  return <div className={`light-home-live${theme === "classic" ? " light-home-live--classic" : ""}`}>
    <header className="light-home-topbar">
      <Link href="/" className="light-home-brand" aria-label="三木趋势首页">
        <span className="light-home-mark">三</span>
        <span><strong>三木趋势</strong><small>RESEARCH JOURNAL</small></span>
      </Link>
      <div className="light-home-topbar-meta"><span className="light-home-live-dot"/>研究空间 · 持续记录</div>
      <div className="light-home-account">
        <button type="button" className="light-home-theme-toggle" aria-pressed={theme === "classic"} onClick={toggleTheme} title="切换首页亮面风格">
          <span aria-hidden="true">{theme === "airy" ? "◌" : "☼"}</span>{theme === "airy" ? "普通亮面" : "柔和亮面"}
        </button>
        {session.data?.signedIn ? <Link href="/profile/" className="light-home-account-link">
          {session.data.avatarUrl ? <img src={session.data.avatarUrl} alt=""/> : <span className="light-home-account-initial">{session.data.nickname?.slice(0, 1) || "研"}</span>}
          <span>{session.data.nickname || "个人中心"}</span>
        </Link> : <><Link href="/login/">登录</Link><Link className="light-home-login" href="/register/">注册 ↗</Link></>}
      </div>
    </header>
    <div className="light-home-body">
      <aside className="light-home-sidebar" aria-label="研究空间导航">
        <div className="light-home-sidebar-title">研究工作台 <small>SPACE</small></div>
        <nav>{navigation.map(([href, label, Icon], index) => <Link key={href} href={href} className={index === 0 ? "active" : undefined} aria-current={index === 0 ? "page" : undefined}><Icon size={16}/><span>{label}</span><small>{String(index + 1).padStart(2, "0")}</small></Link>)}</nav>
        <div className="light-home-sidebar-note"><span>THE PROCESS MATTERS</span><p>观察。等待。执行。<br/>让每一次判断都有迹可循。</p><i/></div>
        <Link className="light-home-member-link" href="/membership/"><UserRound size={16}/>会员中心 <b>↗</b></Link>
        <div className="light-home-sidebar-foot"><span className="light-home-live-dot"/>亮色界面已启用</div>
      </aside>
      <main className="light-home-main">{children}</main>
    </div>
    <div className="light-home-mobile-nav" aria-label="移动端导航">{navigation.slice(0, 4).map(([href, label, Icon], index) => <Link key={href} href={href} className={index === 0 ? "active" : undefined}><Icon size={15}/><span>{label}</span></Link>)}</div>
    <div className="light-home-footer"><span>趋势交易观察室 © 2026</span><span>持续记录 · 独立判断 · 非实时行情</span></div>
  </div>;
}
