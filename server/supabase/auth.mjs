import {configuration} from './client.mjs';
const anonymous={id:null,email:null,signedIn:false,isAdmin:false,role:'guest',nickname:'',avatarUrl:''};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export function administrators(env){return (env.ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)}
export function nickname(value){if(typeof value!=='string'||!value.trim()||value.trim().length>32||/[\x00-\x1f\x7f]/.test(value))fail('昵称请填写1–32个字符');return value.trim()}
export function ownAvatar(path,id){return typeof path==='string'&&path.startsWith('avatars/'+id+'/')&&/^avatars\/[a-f0-9-]+\/[a-f0-9-]+\.jpg$/.test(path)}
export function accessToken(request){const match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('research_access='));if(!match)return '';try{return decodeURIComponent(match.slice(16))}catch{return ''}}
export function emailAddress(value){if(typeof value!=='string'||value.trim().length>254||!/^\S+@\S+\.\S+$/.test(value.trim()))fail('请填写有效的邮箱地址');return value.trim().toLowerCase()}
export function newPassword(value){if(typeof value!=='string'||value.length<8||value.length>72)fail('密码需为8–72个字符');if(new TextEncoder().encode(value).length>72)fail('密码过长：含中文或特殊字符时，UTF-8编码不能超过72字节');return value}
function verificationCode(value){if(typeof value!=='string'||!/^\d{6}$/.test(value.trim()))fail('请输入邮件中的6位数字验证码');return value.trim()}
export function createAuth(env=process.env,transport=fetch){
 const {url,key}=configuration(env);
 async function call(path,body,token,method){
  const response=await transport(url+'/auth/v1'+path,{method:method||(body?'POST':'GET'),headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){
   const error=await response.json().catch(()=>({})),code=error.error_code||error.code;
   const messages={invalid_credentials:'邮箱或密码不正确，请重试或点击忘记密码。',email_not_confirmed:'邮箱尚未验证，请到注册页获取验证码完成注册。',otp_expired:'验证码错误或已过期，请重新获取验证码。',validation_failed:'请检查邮箱地址和验证码。',signup_disabled:'暂未开放注册，请联系管理员。',user_already_exists:'该邮箱已注册，请登录或使用忘记密码。',email_exists:'该邮箱已注册，请登录或使用忘记密码。',email_address_not_authorized:'邮件服务尚未配置完成，请联系管理员。',over_email_send_rate_limit:'验证码发送过于频繁，请稍后重试。',weak_password:'密码强度不足，请使用更长的字母、数字组合。',same_password:'新密码与当前密码相同。',reauthentication_needed:'请重新获取验证码后设置密码。',reauthentication_not_valid:'验证已过期，请重新获取验证码。',current_password_required:'请使用忘记密码验证邮箱后设置密码。'};
   const fallback=response.status===429?'请求过于频繁，请稍后重试':path.startsWith('/token')?'邮箱或密码不正确，请重试或点击忘记密码。':path==='/signup'||path==='/recover'?'验证码暂未发送，请检查邮箱或稍后重试。':path==='/verify'?'验证码错误或已过期，请重新获取验证码。':'登录已过期，请重新登录。';
   throw Object.assign(new Error(messages[code]||fallback),{code,status:response.status>=500?503:response.status===429?429:400});
  }
  return response.status===204?null:response.json();
 }
 async function nicknameRpc(name,input){
  const response=await transport(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,...(!key.startsWith('sb_secret_')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){
   const error=await response.json().catch(()=>({}));
   const messages={'PT400':'昵称或头像信息不正确','PT401':'请先验证邮箱并登录','PT409':'该昵称已被使用，请更换昵称','PT503':'默认昵称号段已满，请联系管理员'};
   const message=messages[error.code],status=message?Number(error.code.slice(2)):503;
   throw Object.assign(new Error(message||'昵称服务暂时不可用，请稍后重试'),{status,...(message&&status===503?{publicMessage:message}:{})});
  }
  return response.json();
 }
 function confirmed(user){return typeof user?.id==='string'&&!!user.id&&typeof user.email==='string'&&!!user.email&&!!user.email_confirmed_at}
 function project(user,name){if(!confirmed(user))return anonymous;const isAdmin=administrators(env).includes(user.email.toLowerCase());const path=user.user_metadata?.avatar_path;return {id:user.id,email:user.email,signedIn:true,isAdmin,role:isAdmin?'admin':'user',nickname:nickname(name),avatarUrl:ownAvatar(path,user.id)?'/api/profile/avatar/?v='+path.split('/').pop():''}}
 async function withNickname(user){if(!confirmed(user))return anonymous;const saved=await nicknameRpc('ensure_user_nickname',{p_user_id:user.id});return project(user,saved.nickname)}
 async function checkedSession(session,address){
  if(!session?.access_token)fail('验证未完成，请重新获取验证码',401);
  const raw=await call('/user',null,session.access_token);
  if(!confirmed(raw)||raw.email.toLowerCase()!==address)fail('邮箱验证未完成，请重新登录',401);
  const user=await withNickname(raw);
  return {user,token:session.access_token,expires:Math.min(session.expires_in||3600,3600)};
 }
 async function verifiedCode(email,code,type){
  const address=emailAddress(email),token=verificationCode(code);
  return checkedSession(await call('/verify',{email:address,token,type}),address);
 }
 async function setVerifiedPassword(session,password){
  try{await call('/user',{password},session.token,'PUT')}
  catch(error){
   // After a verified identity, this means the requested password is already set.
   if(error.code==='same_password')return;
   if(error.status<500)fail('密码尚未设置成功。'+error.message+' 请重新获取验证码后再试。',error.status);
   const message='密码设置结果尚未确认，请先尝试用新密码登录；如无法登录，请通过忘记密码重新获取验证码。';
   throw Object.assign(new Error(message),{status:503,publicMessage:message});
  }
 }
 return {
  async identify(request){const token=accessToken(request);if(!token)return anonymous;try{return await withNickname(await call('/user',null,token))}catch(e){if([400,401,403].includes(e.status))return anonymous;throw e}},
  async login(email,password){
   const address=emailAddress(email);
   if(typeof password!=='string'||!password.length||password.length>1024)fail('请填写邮箱和密码');
   return checkedSession(await call('/token?grant_type=password',{email:address,password}),address);
  },
  async sendRegistration(email,password){
   const address=emailAddress(email),chosen=newPassword(password);
   const result=await call('/signup',{email:address,password:chosen});
   if(result?.access_token)fail('注册需要开启邮箱验证，请联系管理员。',503);
   return {codeSent:true,retryAfter:60};
  },
  async register(email,password,code){
   const chosen=newPassword(password),session=await verifiedCode(email,code,'signup');
   // Repeated signups do not replace an unconfirmed user's stored password.
   // Apply the mailbox owner's choice only after verifying their signup code.
   await setVerifiedPassword(session,chosen);
   return session;
  },
  async sendPasswordReset(email){await call('/recover',{email:emailAddress(email)});return {codeSent:true,retryAfter:60}},
  async resetPassword(email,password,code){
   const chosen=newPassword(password),session=await verifiedCode(email,code,'recovery');
   await setVerifiedPassword(session,chosen);
   // Password update already revokes other sessions. Retire this recovery session too.
   try{await call('/logout',{},session.token)}catch{}
   return {passwordReset:true};
  },
  async profile(request){const token=accessToken(request);if(!token)fail('请先登录',401);const raw=await call('/user',null,token);if(!confirmed(raw))fail('请先登录',401);return {user:await withNickname(raw),avatarPath:ownAvatar(raw.user_metadata?.avatar_path,raw.id)?raw.user_metadata.avatar_path:''}},
  async updateProfile(request,name,avatarPath){
   const chosen=nickname(name),token=accessToken(request);if(!token)fail('请先登录',401);
   const raw=await call('/user',null,token);if(!confirmed(raw))fail('请先登录',401);
   if(avatarPath&&!ownAvatar(avatarPath,raw.id))fail('头像路径不属于当前用户');
   const saved=await nicknameRpc('set_user_nickname',{p_user_id:raw.id,p_nickname:chosen,p_avatar_path:avatarPath||null});
   return project({...raw,user_metadata:{...raw.user_metadata,...(avatarPath?{avatar_path:avatarPath}:{})}},saved.nickname);
  },
  async logout(request){const token=accessToken(request);if(token){try{await call('/logout',{},token)}catch(e){if(![400,401,403].includes(e.status))throw e}}},
 };
}
export function sessionCookie(token,expires,secure=true){return `research_access=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires}${secure?'; Secure':''}`}
