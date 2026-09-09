import Link from 'next/link';
export const metadata={title:'登录'};
export default function Login(){return <div className="reading"><div className="eyebrow">YOUR RESEARCH SPACE</div><h1>登录入口</h1><div className="member-status"><h2>账号功能尚未开放</h2><p>初版可以直接浏览公开内容。邮箱登录、会员身份与有效期将在接入账号服务后启用。</p><Link href="/" className="button">继续浏览公开内容 ↗</Link></div></div>}
