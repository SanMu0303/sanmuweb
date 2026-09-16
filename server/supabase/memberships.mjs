// Server-only membership access. Administrator identity is supplied by verified Auth.
import {configuration} from './client.mjs';
const states=new Set(['none','active','expired','revoked']);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function userId(value){if(typeof value!=='string'||!uuid.test(value))fail('用户标识不正确');return value.toLowerCase()}
function revision(value){if(!Number.isInteger(value)||value<0||value>=2147483647)fail('缺少有效的会员版本号，请刷新后重试');return value}
function isoDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const time=Date.parse(value),date=Date.parse(value.slice(0,10)+'T00:00:00Z');
 if(!Number.isFinite(time)||!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==value.slice(0,10)||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return null;
 return new Date(time).toISOString();
}
function membership(value){
 if(!value||!states.has(value.status)||!Number.isInteger(value.revision)||value.revision<0)fail('会员服务返回异常，请稍后重试',503);
 const expiresAt=value.expiresAt===null?null:isoDate(value.expiresAt);
 if(value.expiresAt!==null&&!expiresAt)fail('会员服务返回异常，请稍后重试',503);
 if(value.status==='none'?(value.revision!==0||expiresAt!==null):(value.revision<1||(['active','expired'].includes(value.status)&&expiresAt===null)))fail('会员服务返回异常，请稍后重试',503);
 // Deliberately retain only these fields; status is decided by the database clock.
 return {status:value.status,expiresAt,revision:value.revision};
}
export function createMemberships(env=process.env,transport=fetch){
 const {url,key}=configuration(env);
 const admins=new Set((env.ADMIN_EMAILS||'').split(',').map(email=>email.trim().toLowerCase()).filter(Boolean));
 async function rpc(name,input){
  let response;
  try{response=await transport(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,...(!key.startsWith('sb_secret_')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})}
  catch{fail('会员服务暂时不可用，请稍后重试',503)}
  let result;try{result=await response.json()}catch{fail('会员服务暂时不可用，请稍后重试',503)}
  if(!response.ok){
   const allowed=new Set(['会员列表筛选或页码不正确','管理员身份验证失败，请重新登录','会员操作或版本号不正确','请设置有效的未来到期时间','用户不存在或邮箱尚未确认，不能修改会员','会员信息已更新，请刷新后重试']);
   if(['PT400','PT403','PT409'].includes(result?.code)&&allowed.has(result.message))fail(result.message,Number(result.code.slice(2)));
   fail(response.status===429?'会员操作过于频繁，请稍后重试':'会员服务暂时不可用，请稍后重试',response.status===429?429:503);
  }
  return result;
 }
 return {
  async get(id){return membership(await rpc('get_user_membership',{p_user_id:userId(id)}))},
  async list({query='',page=1,status='all'}={}){
   if(typeof query!=='string'||query.trim().length>100||!Number.isInteger(page)||page<1||page>100000||!['all',...states].includes(status))fail('会员列表筛选或页码不正确');
   const result=await rpc('list_membership_users',{p_query:query.trim(),p_page:page,p_status:status});
   if(!result||!Array.isArray(result.users)||result.users.length>20||result.page!==page||result.pageSize!==20||!Number.isSafeInteger(result.total)||result.total<0)fail('会员列表返回异常，请稍后重试',503);
   const users=result.users.map(row=>{
    if(!row||typeof row.id!=='string'||!uuid.test(row.id)||typeof row.email!=='string'||typeof row.nickname!=='string'||typeof row.confirmed!=='boolean'||(row.createdAt!==null&&!isoDate(row.createdAt)))fail('会员列表返回异常，请稍后重试',503);
    return {id:row.id,email:row.email,nickname:row.nickname,createdAt:row.createdAt===null?null:isoDate(row.createdAt),confirmed:row.confirmed,isAdmin:admins.has(row.email.trim().toLowerCase()),membership:membership(row.membership)};
   });
   return {users,page,pageSize:20,total:result.total};
  },
  async save(actor,id,input){
   if(!actor||actor.isAdmin!==true||typeof actor.email!=='string'||!admins.has(actor.email.trim().toLowerCase()))fail('当前账号没有管理权限',403);
   const actorId=userId(actor.id),targetId=userId(id);
   if(!input||!['set','revoke'].includes(input.action))fail('会员操作不正确');
   const expectedRevision=revision(input.revision);
   let expiresAt=null;
   if(input.action==='set'){
    expiresAt=isoDate(input.expiresAt);
    if(!expiresAt||Date.parse(expiresAt)<=Date.now())fail('请设置有效的未来到期时间');
   }
   const saved=membership(await rpc('save_user_membership',{p_actor_id:actorId,p_actor_email:actor.email.trim().toLowerCase(),p_user_id:targetId,p_action:input.action,p_expires_at:expiresAt,p_revision:expectedRevision}));
   if(saved.revision!==expectedRevision+1||(input.action==='revoke'?saved.status!=='revoked':!['active','expired'].includes(saved.status)||saved.expiresAt!==expiresAt))fail('会员保存结果异常，请刷新后确认',503);
   return saved;
  },
 };
}
