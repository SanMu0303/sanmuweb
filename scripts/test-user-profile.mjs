import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configuration,createSupabase} from '../server/supabase/client.mjs';
import {createAuth} from '../server/supabase/auth.mjs';
import {createProfile} from '../server/supabase/profile.mjs';
import {createApi} from '../server/supabase/api.mjs';
const {url,key}=configuration(),client=createSupabase(),auth=createAuth();
const email='profile-qa-'+Date.now()+'@example.net',password=crypto.randomUUID()+'Aa9!';let id,path;
async function admin(method,route,data){const r=await fetch(url+'/auth/v1/admin/'+route,{method,headers:{apikey:key,...(!key.startsWith('sb_secret_')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error('Test auth setup failed '+r.status+' '+(d.error_code||d.msg||''));return d}
try{
 const created=await admin('POST','users',{email,password,email_confirm:true,user_metadata:{nickname:'验收用户'}});id=created.id||created.user?.id;assert.ok(id);
 const session=await auth.login(email,password);assert.equal(session.user.isAdmin,false);assert.equal(session.user.signedIn,true);assert.equal(session.user.role,'user');
 const request=new Request('https://sanmuweb.vercel.app/api/profile',{headers:{cookie:'research_access='+session.token}});
 const service=createProfile(client);const jpeg=await readFile('/tmp/profile-acceptance.jpg');const saved=await service.save(request,{nickname:'新昵称验收',avatarData:'data:image/jpeg;base64,'+jpeg.toString('base64')},auth);assert.equal(saved.nickname,'新昵称验收');assert.ok(saved.avatarUrl);const persisted=await auth.profile(request);path=persisted.avatarPath;assert.equal(persisted.user.nickname,'新昵称验收');assert.ok(path.startsWith('avatars/'+id+'/'));
 const avatar=await service.avatar(request,auth);assert.equal(avatar.status,302);const image=await fetch(avatar.headers.get('location'));assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/jpeg/);await image.arrayBuffer();
 const api=createApi();for(const route of ['/api/admin/articles','/api/admin/watchlist','/api/admin/videos']){const response=await api(new Request('https://sanmuweb.vercel.app'+route,{headers:{cookie:'research_access='+session.token}}));assert.equal(response.status,403)}
 console.log('PASS: ordinary-user login, durable nickname/avatar, private storage read, all admin endpoints denied');
}finally{if(path)await client.request('/storage/v1/object/'+client.config.bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});if(id)await admin('DELETE','users/'+id);console.log('Only temporary test account and avatar removed')}
