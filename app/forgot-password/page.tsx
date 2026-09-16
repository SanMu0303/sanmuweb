import AdminLogin from '@/components/AdminLogin';
export const metadata={title:'忘记密码'};
export default function ForgotPassword(){return <div className="reading"><h1>找回账号密码</h1><AdminLogin resetPassword/></div>}
