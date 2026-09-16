import type {Metadata} from 'next';
import './globals.css';
import '@/components/membership.css';
import Shell from '@/components/Shell';
export const metadata:Metadata={title:{default:'趋势交易观察室',template:'%s · 趋势交易观察室'},description:'持续记录趋势观察、交易计划与市场复盘。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><Shell>{children}</Shell></body></html>}
