import {createSupabase} from './client.mjs';
import {nickname} from './auth.mjs';
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s})};
export function createProfile(client=createSupabase()){
 const bucket=encodeURIComponent(client.config.bucket);
 const remove=path=>client.request('/storage/v1/object/'+bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});
 return {
 async avatar(request,auth){const {avatarPath}=await auth.profile(request);if(!avatarPath)fail('尚未设置头像',404);const d=await client.request('/storage/v1/object/sign/'+bucket+'/'+avatarPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});return new Response(null,{status:302,headers:{Location:client.config.url+'/storage/v1'+d.signedURL,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})},
 async save(request,input,auth){const name=nickname(input.nickname);const current=await auth.profile(request);let path='';if(input.avatarData){if(typeof input.avatarData!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.avatarData))fail('头像格式不正确');const bytes=Buffer.from(input.avatarData.split(',')[1],'base64');if(bytes.length>131072||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('头像无效或超过128KB，请重新选择图片');path='avatars/'+current.user.id+'/'+crypto.randomUUID()+'.jpg';await client.request('/storage/v1/object/'+bucket+'/'+path,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:bytes});}
 try{const saved=await auth.updateProfile(request,name,path);if(path&&current.avatarPath)await remove(current.avatarPath).catch(()=>{});return saved}catch(e){if(path)await remove(path).catch(()=>{});throw e}
 }
 };
}
