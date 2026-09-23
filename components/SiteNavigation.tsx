"use client";

import Link from "next/link";
import {Activity, ArrowUpRight, BookOpen, Compass, LineChart, NotebookPen, UserRound} from "lucide-react";
import type {SiteTheme} from "@/components/site-theme";

export type SiteSession = {
  isAdmin?: boolean;
  signedIn?: boolean;
  nickname?: string;
  avatarUrl?: string;
};

export const siteNavigation = [
  ["/", "最新内容", Compass],
  ["/watchlist/", "趋势观察池", Activity],
  ["/terminal/", "交易终端", LineChart],
  ["/reviews/", "市场复盘", NotebookPen],
  ["/knowledge/", "知识库 / 课程", BookOpen],
] as const;

export function isSiteNavigationActive(path: string, href: string) {
  const normalize = (value: string) => value.length > 1 ? value.replace(/\/+$/, "") : value;
  const current = normalize(path);
  const target = normalize(href);
  return target === "/" ? current === "/" : current === target || current.startsWith(`${target}/`);
}

export function SiteNavigationContent({
  path,
  theme,
  session,
  onNavigate,
}: {
  path: string;
  theme: SiteTheme;
  session?: SiteSession | null;
  onNavigate?: () => void;
}) {
  return <div className="site-navigation-content">
    <div className="site-nav-heading"><strong>研究工作台</strong></div>
    <nav className="site-nav-links" aria-label="研究栏目">
      {siteNavigation.map(([href, label, Icon]) => {
        const active = isSiteNavigationActive(path, href);
        return <Link
          key={href}
          href={href}
          className={active ? "active" : undefined}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
        >
          <Icon size={19} aria-hidden="true"/>
          <span>{label}</span>
        </Link>;
      })}
    </nav>
    <div className="site-nav-note" aria-hidden="true">
      <span>THE PROCESS MATTERS</span>
      <p>观察。等待。执行。<br/>让每一次判断都有迹可循。</p>
      <i/>
    </div>
    <div className="site-nav-account" aria-label="账户入口">
      <Link className="site-nav-member" href="/membership/" onClick={onNavigate}>
        <UserRound size={19} aria-hidden="true"/><span>会员中心</span><ArrowUpRight size={15} aria-hidden="true"/>
      </Link>
      {session?.signedIn && <Link
        href="/profile/"
        className={`site-nav-secondary ${isSiteNavigationActive(path, "/profile/") ? "active" : ""}`}
        aria-current={isSiteNavigationActive(path, "/profile/") ? "page" : undefined}
        onClick={onNavigate}
      >
        <UserRound size={19} aria-hidden="true"/><span>个人中心</span><ArrowUpRight size={14} aria-hidden="true"/>
      </Link>}
      {session?.isAdmin && <Link
        href="/admin/"
        className={`site-nav-secondary ${isSiteNavigationActive(path, "/admin/") ? "active" : ""}`}
        aria-current={isSiteNavigationActive(path, "/admin/") ? "page" : undefined}
        onClick={onNavigate}
      >
        <NotebookPen size={19} aria-hidden="true"/><span>内容管理</span><ArrowUpRight size={14} aria-hidden="true"/>
      </Link>}
    </div>
    <div className="site-nav-status"><span className="site-live-dot"/>{theme === "dark" ? "暗色界面已启用" : "柔和亮面已启用"}</div>
  </div>;
}
