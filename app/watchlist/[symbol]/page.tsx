import WatchDetail from '@/components/WatchDetail';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{symbol:string}>}){const {symbol}=await params;return <WatchDetail symbol={decodeURIComponent(symbol).toUpperCase()}/>}
