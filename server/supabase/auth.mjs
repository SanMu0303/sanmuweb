import {configuration} from './client.mjs';
const anonymous={id:null,email:null,signedIn:false,isAdmin:false,role:'guest',nickname:'',avatarUrl:''};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export function administrators(env){return (env.ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)}
export function nickname(value){if(typeof value!=='string'||!value.trim()||value.trim().length>32||/[\x00-\x1f\x7f]/.test(value))fail('昵称请填写1–32个字符');return value.trim()}
export function ownAvatar(path,id){return typeof path==='string'&&path.startsWith('avatars/'+id+'/')&&/^avatars\/[a-f0-9-]+\/[a-f0-9-]+\.jpg$/.test(path)}
export function accessToken(request){const match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('research_access='));if(!match)return '';try{return decodeURIComponent(match.slice(16))}catch{return ''}}
export function createAuth(env=process.env,transport=fetch){
 const {url,key}=configuration(env);
 async function call(path,body,token,method){
  const response=await transport(url+'/auth/v1'+path,{method:method||(body?'POST':'GET'),headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){const error=await response.json().catch(()=>({}));const messages={email_not_confirmed:'请先打开注册邮件确认邮箱，再登录。',signup_disabled:'暂未开放注册，请联系管理员。',email_address_not_authorized:'注册邮件服务尚未配置完成，请联系管理员。',over_email_send_rate_limit:'确认邮件发送过于频繁，请稍后重试。',weak_password:'密码强度不足，请使用更长的字母、数字组合。'};fail(messages[error.error_code||error.code]||(response.status===429?'请求过于频繁，请稍后重试':path.startsWith('/signup')?'注册暂未完成，请检查邮箱格式或稍后重试。':'邮箱或密码不正确，或登录已过期。'),response.status>=500?503:response.status===429?429:400)}
  return response.status===204?null:response.json();
 }
 function project(user){if(!user?.id||!user?.email_confirmed_at)return anonymous;const isAdmin=administrators(env).includes((user.email||'').toLowerCase());const path=user.user_metadata?.avatar_path;let name='研究员';try{name=nickname(user.user_metadata?.nickname)}catch{}return {id:user.id,email:user.email,signedIn:true,isAdmin,role:isAdmin?'admin':'user',nickname:name,avatarUrl:ownAvatar(path,user.id)?'/api/profile/avatar/?v='+path.split('/').pop():''}}
 return {
  async identify(request){const token=accessToken(request);if(!token)return anonymous;try{return project(await call('/user',null,token))}catch(e){if([400,401,403].includes(e.status))return anonymous;throw e}},
  async login(email,password){if(typeof email!=='string'||typeof password!=='string'||password.length>1024||!email.trim()||email.length>254)fail('邮箱或密码不正确',401);const session=await call('/token?grant_type=password',{email:email.trim().toLowerCase(),password});const user=project(await call('/user',null,session.access_token));if(!user.signedIn)fail('请先确认邮箱',401);return {user,token:session.access_token,expires:Math.min(session.expires_in||3600,3600)}},
  async register(email,password,name,origin){if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<8||password.length>72)fail('请填写有效邮箱，密码需8–72个字符');const session=await call('/signup?redirect_to='+encodeURIComponent(origin+'/login/?confirmed=1'),{email:email.trim().toLowerCase(),password,data:{nickname:nickname(name)}});if(session.access_token){const user=project(await call('/user',null,session.access_token));if(user.signedIn)return {user,token:session.access_token,expires:Math.min(session.expires_in||3600,3600)}}return {confirmationRequired:true}},
  async profile(request){const token=accessToken(request);if(!token)fail('请先登录',401);const raw=await call('/user',null,token);if(!project(raw).signedIn)fail('请先登录',401);return {user:project(raw),avatarPath:ownAvatar(raw.user_metadata?.avatar_path,raw.id)?raw.user_metadata.avatar_path:''}},
  async updateProfile(request,name,avatarPath){const token=accessToken(request);if(!token)fail('请先登录',401);const data={nickname:nickname(name),...(avatarPath?{avatar_path:avatarPath}:{})};return project(await call('/user',{data},token,'PUT'))},
  async logout(request){const token=accessToken(request);if(token){try{await call('/logout',{},token)}catch(e){if(![400,401,403].includes(e.status))throw e}}},
 };
}
export function sessionCookie(token,expires,secure=true){return `research_access=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires}${secure?'; Secure':''}`}
