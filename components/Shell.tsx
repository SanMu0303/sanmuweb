"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useResource} from "@/lib/live";
import MobileNavigationDrawer from "@/components/MobileNavigationDrawer";
import {SiteNavigationContent, type SiteSession} from "@/components/SiteNavigation";
import {useSiteTheme} from "@/components/SiteThemeProvider";

export default function Shell({children}: {children: React.ReactNode}) {
  const path = usePathname() || "/";
  const session = useResource<SiteSession>("/api/session");
  const {theme, toggleTheme} = useSiteTheme();
  const nextThemeLabel = theme === "soft" ? "切换为暗色" : "切换为亮色";

  return <div className={`site-shell site-shell--${theme}`} data-theme={theme}>
    <aside className="sidebar site-navigation" aria-label="研究空间导航">
      <SiteNavigationContent path={path} theme={theme} session={session.data}/>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-location">
          <MobileNavigationDrawer path={path} theme={theme} session={session.data}/>
          <Link href="/" className="site-topbar-brand" aria-label="三木趋势首页">
            <span className="site-topbar-mark">三</span>
            <span><strong>三木趋势</strong><small>RESEARCH JOURNAL</small></span>
          </Link>
          <span className="site-topbar-meta"><span className="site-live-dot"/>研究空间 · 持续记录</span>
        </div>
        <div className="account-links">
          <button type="button" className="site-theme-toggle" aria-pressed={theme === "dark"} onClick={toggleTheme} title={nextThemeLabel} aria-label={nextThemeLabel}>
            <span aria-hidden="true">{theme === "soft" ? "☾" : "☼"}</span>{nextThemeLabel}
          </button>
          {session.data?.signedIn ? <Link className="account-identity" href="/profile/" aria-label="打开个人中心">
            {session.data.avatarUrl ? <img src={session.data.avatarUrl} alt="我的头像"/> : <span className="account-initial">{session.data.nickname?.slice(0, 1) || "研"}</span>}
            <span>{session.data.nickname || "研究员"}</span>
          </Link> : <><Link href="/login/">登录</Link><Link className="login-pill" href="/register/">注册账号 ↗</Link></>}
        </div>
      </header>
      <main>{children}</main>
      <footer><span>趋势交易观察室 © 2026</span><span>持续记录 · 独立判断 · 非实时行情</span></footer>
    </div>
  </div>;
}
