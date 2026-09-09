import Link from 'next/link';
export default function NotFound(){return <div className="empty"><span className="eyebrow">404 / NOT FOUND</span><h1>这篇记录暂时不在这里</h1><p>链接可能已经变更，可以回到内容首页继续浏览。</p><Link className="button" href="/">返回首页</Link></div>}
