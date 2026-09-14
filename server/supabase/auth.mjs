import {configuration} from './client.mjs';
const anonymous={id:null,email:null,signedIn:false,isAdmin:false};
export function administrators(env){return (env.ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)}
export function createAuth(env=process.env,transport=fetch){
 const {url,key}=configuration(env);
 async function call(path,body,token){
  const response=await transport(url+'/auth/v1'+path,{method:body?'POST':'GET',headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Object.assign(new Error(response.status===429?'请求过于频繁，请稍后重试':'登录验证失败，请重新登录'),{status:response.status>=500?503:response.status===429?429:401});
  return response.status===204?null:response.json();
 }
 function project(user){return user?.id&&user?.email_confirmed_at?{id:user.id,email:user.email,signedIn:true,isAdmin:administrators(env).includes((user.email||'').toLowerCase())}:anonymous}
 return {
  async identify(request){
   const match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('research_access='));
   if(!match)return anonymous;
   let token;try{token=decodeURIComponent(match.slice('research_access='.length))}catch{return anonymous}
   try{return project(await call('/user',null,token))}catch(e){if(e.status===401)return anonymous;throw e}
  },
  async login(email,password){
   if(typeof email!=='string'||typeof password!=='string'||password.length>1024||!administrators(env).includes(email.trim().toLowerCase()))throw Object.assign(new Error('邮箱或密码不正确'),{status:401});
   const session=await call('/token?grant_type=password',{email:email.trim().toLowerCase(),password});
   const user=project(await call('/user',null,session.access_token));
   if(!user.isAdmin)throw Object.assign(new Error('当前账号没有管理权限'),{status:403});
   return {user,token:session.access_token,expires:Math.min(session.expires_in||3600,3600)};
  },
  async logout(request){const match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('research_access='));if(match){try{await call('/logout',{ },decodeURIComponent(match.slice(16)))}catch(e){if(e.status!==401)throw e}}},
 };
}
export function sessionCookie(token,expires,secure=true){return `research_access=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires}${secure?'; Secure':''}`}
