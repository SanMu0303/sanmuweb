import type {Metadata} from 'next';
import './globals.css';
import '@/components/site-themes.css';
import '@/components/membership.css';
import '@/components/session-security.css';
import RouteFrame from '@/components/RouteFrame';

export const metadata:Metadata={title:{default:'趋势交易观察室',template:'%s · 趋势交易观察室'},description:'持续记录趋势观察、交易计划与市场复盘。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body style={{margin:0}}><RouteFrame>{children}</RouteFrame></body></html>}
