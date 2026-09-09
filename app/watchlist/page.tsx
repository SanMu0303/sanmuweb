import Watchlist from '@/components/Watchlist';
import {listWatchlist} from '@/lib/repository';
export const metadata={title:'趋势观察池'};
export default async function Page(){return <><div className="page-heading"><div><div className="eyebrow">THE WATCHLIST</div><h1>趋势观察池</h1><p>关注依据，跟踪阶段，也保留判断失效的理由。</p></div></div><Watchlist items={await listWatchlist()}/></>}
