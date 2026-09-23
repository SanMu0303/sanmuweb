"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useResource} from "@/lib/live";
import MobileNavigationDrawer from "@/components/MobileNavigationDrawer";
import {SiteNavigationContent, type SiteSession} from "@/components/SiteNavigation";
import {useSiteTheme} from "@/components/SiteThemeProvider";

export default function LiveLightHomeShell({children}: {children: React.ReactNode}) {
  const path = usePathname() || "/";
  const session = useResource<SiteSession>("/api/session");
  const {theme, toggleTheme} = useSiteTheme();
  const nextThemeLabel = theme === "soft" ? "切换为暗色" : "切换为亮色";

  return <div className={`light-home-live${theme === "dark" ? " light-home-live--dark" : ""}`} data-theme={theme}>
    <header className="light-home-topbar">
      <div className="light-home-topbar-location">
        <MobileNavigationDrawer path={path} theme={theme} session={session.data} triggerClassName="light-home-mobile-menu-toggle"/>
        <Link href="/" className="light-home-brand" aria-label="三木趋势首页">
          <span className="light-home-mark">三</span>
          <span><strong>三木趋势</strong><small>RESEARCH JOURNAL</small></span>
        </Link>
        <div className="light-home-topbar-meta"><span className="light-home-live-dot"/>研究空间 · 持续记录</div>
      </div>
      <div className="light-home-account">
        <button type="button" className="light-home-theme-toggle" aria-pressed={theme === "dark"} onClick={toggleTheme} title={nextThemeLabel} aria-label={nextThemeLabel}>
          <span aria-hidden="true">{theme === "soft" ? "☾" : "☼"}</span>{nextThemeLabel}
        </button>
        {session.data?.signedIn ? <Link href="/profile/" className="light-home-account-link">
          {session.data.avatarUrl ? <img src={session.data.avatarUrl} alt="我的头像"/> : <span className="light-home-account-initial">{session.data.nickname?.slice(0, 1) || "研"}</span>}
          <span>{session.data.nickname || "个人中心"}</span>
        </Link> : <><Link href="/login/">登录</Link><Link className="light-home-login" href="/register/">注册 ↗</Link></>}
      </div>
    </header>
    <div className="light-home-body">
      <aside className="light-home-sidebar site-navigation" aria-label="研究空间导航">
        <SiteNavigationContent path={path} theme={theme} session={session.data}/>
      </aside>
      <main className="light-home-main">{children}</main>
    </div>
    <div className="light-home-footer"><span>趋势交易观察室 © 2026</span><span>持续记录 · 独立判断 · 非实时行情</span></div>
  </div>;
}
