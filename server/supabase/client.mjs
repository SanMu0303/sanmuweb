// Server-only HTTP client. Do not import this module into client components.
export function configuration(env=process.env) {
 const url=env.SUPABASE_URL;
 const key=env.SUPABASE_SECRET_KEY;
 if(!url||!key)throw new Error('请配置 SUPABASE_URL 和 SUPABASE_SECRET_KEY');
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('SUPABASE_URL 必须是 HTTPS 项目根地址');
 return {url:parsed.origin,key,bucket:env.SUPABASE_IMAGE_BUCKET||'research-images'};
}
export function createSupabase(env=process.env,transport=fetch) {
 const config=configuration(env);
 return {config,async request(path,options={}) {
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))throw new Error('无效的 Supabase 接口路径');
  const headers=new Headers(options.headers);
  headers.set('apikey',config.key);
  // Legacy service_role JWT uses Bearer; new sb_secret keys use apikey.
  if(!config.key.startsWith('sb_secret_'))headers.set('Authorization','Bearer '+config.key);
  const response=await transport(config.url+path,{...options,headers,cache:'no-store',redirect:'error',signal:options.signal||AbortSignal.timeout(30000)});
  if(!response.ok){
   const error=await response.json().catch(()=>null);
   const messages=['本周重点最多3个，请先取消其他标的','观察池已更新，请刷新后重新同步','已有同名标的属于其他市场，请核对市场和标的代码','记录已更新，请重新载入','图片未完成上传或不属于当前记录'];
   throw Object.assign(new Error(messages.includes(error?.message)?error.message:`Supabase 请求失败（${response.status}）`),{status:response.status});
  }
  return response.status===204?null:response.json();
 }};
}
