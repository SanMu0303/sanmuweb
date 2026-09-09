import Link from 'next/link';
export const metadata={title:'登录'};
export default function Login(){return <div className="reading"><div className="eyebrow">YOUR RESEARCH SPACE</div><h1>登录研究空间</h1><div className="member-status"><h2>管理员登录</h2><p>使用站点管理员对应的 ChatGPT 账号登录后，可以写文章、保存草稿并维护观察池。</p><a className="button" href="/signin-with-chatgpt?return_to=%2Fadmin%2F" target="_top">使用 ChatGPT 登录 ↗</a><p className="mt-5">普通读者的会员付费与解锁功能尚未开放。</p><Link href="/">继续浏览公开内容</Link></div></div>}
