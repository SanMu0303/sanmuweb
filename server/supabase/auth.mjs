import {configuration} from './client.mjs';
const anonymous={id:null,email:null,signedIn:false,isAdmin:false,role:'guest',nickname:'',avatarUrl:''};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export function administrators(env){return (env.ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)}
export function nickname(value){if(typeof value!=='string'||!value.trim()||value.trim().length>32||/[\x00-\x1f\x7f]/.test(value))fail('昵称请填写1–32个字符');return value.trim()}
export function ownAvatar(path,id){return typeof path==='string'&&path.startsWith('avatars/'+id+'/')&&/^avatars\/[a-f0-9-]+\/[a-f0-9-]+\.jpg$/.test(path)}
export function accessToken(request){const match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('research_access='));if(!match)return '';try{return decodeURIComponent(match.slice(16))}catch{return ''}}
export function emailAddress(value){if(typeof value!=='string'||value.trim().length>254||!/^\S+@\S+\.\S+$/.test(value.trim()))fail('请填写有效的邮箱地址');return value.trim().toLowerCase()}
export function createAuth(env=process.env,transport=fetch){
 const {url,key}=configuration(env);
 async function call(path,body,token,method){
  const response=await transport(url+'/auth/v1'+path,{method:method||(body?'POST':'GET'),headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){const error=await response.json().catch(()=>({}));const messages={email_not_confirmed:'请先获取邮箱验证码并完成验证。',otp_expired:'验证码错误或已过期，请重新获取验证码。',validation_failed:'请检查邮箱地址和验证码。',signup_disabled:'暂未开放注册，请联系管理员。',email_address_not_authorized:'注册邮件服务尚未配置完成，请联系管理员。',over_email_send_rate_limit:'验证码发送过于频繁，请稍后重试。',weak_password:'密码强度不足，请使用更长的字母、数字组合。'};fail(messages[error.error_code||error.code]||(response.status===429?'请求过于频繁，请稍后重试':path==='/otp'?'验证码暂未发送，请检查邮箱或稍后重试。':path==='/verify'?'验证码错误或已过期，请重新获取验证码。':'登录已过期，请重新验证邮箱。'),response.status>=500?503:response.status===429?429:400)}
  return response.status===204?null:response.json();
 }
 function project(user){if(!user?.id||!user?.email_confirmed_at)return anonymous;const isAdmin=administrators(env).includes((user.email||'').toLowerCase());const path=user.user_metadata?.avatar_path;let name='研究员';try{name=nickname(user.user_metadata?.nickname)}catch{}return {id:user.id,email:user.email,signedIn:true,isAdmin,role:isAdmin?'admin':'user',nickname:name,avatarUrl:ownAvatar(path,user.id)?'/api/profile/avatar/?v='+path.split('/').pop():''}}
 return {
  async identify(request){const token=accessToken(request);if(!token)return anonymous;try{return project(await call('/user',null,token))}catch(e){if([400,401,403].includes(e.status))return anonymous;throw e}},
  async sendOtp(email){await call('/otp',{email:emailAddress(email),create_user:true});return {codeSent:true,retryAfter:60}},
  async verifyOtp(email,code){
   const address=emailAddress(email);
   if(typeof code!=='string'||!/^\d{6,8}$/.test(code.trim()))fail('请输入邮件中的6–8位数字验证码');
   const session=await call('/verify',{email:address,token:code.trim(),type:'email'});
   if(!session.access_token)fail('验证未完成，请重新获取验证码',401);
   const user=project(await call('/user',null,session.access_token));
   if(!user.signedIn||user.email.toLowerCase()!==address)fail('邮箱验证未完成，请重新登录',401);
   return {user,token:session.access_token,expires:Math.min(session.expires_in||3600,3600)};
  },
  async profile(request){const token=accessToken(request);if(!token)fail('请先登录',401);const raw=await call('/user',null,token);if(!project(raw).signedIn)fail('请先登录',401);return {user:project(raw),avatarPath:ownAvatar(raw.user_metadata?.avatar_path,raw.id)?raw.user_metadata.avatar_path:''}},
  async updateProfile(request,name,avatarPath){const token=accessToken(request);if(!token)fail('请先登录',401);const data={nickname:nickname(name),...(avatarPath?{avatar_path:avatarPath}:{})};return project(await call('/user',{data},token,'PUT'))},
  async logout(request){const token=accessToken(request);if(token){try{await call('/logout',{},token)}catch(e){if(![400,401,403].includes(e.status))throw e}}},
 };
}
export function sessionCookie(token,expires,secure=true){return `research_access=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires}${secure?'; Secure':''}`}
