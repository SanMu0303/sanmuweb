import {createApi} from '@/server/supabase/api.mjs';
import videos from '@/content/videos.json';
import courses from '@/content/courses.json';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request){
 try{return await createApi({videos,courses})(request)}catch(error){console.error('API initialization failed', {errorType:error instanceof Error?error.name:'Unknown',hasUrl:!!process.env.SUPABASE_URL,hasKey:!!process.env.SUPABASE_SECRET_KEY,urlIsProjectRoot:(()=>{try{const u=new URL(process.env.SUPABASE_URL||'');return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash}catch{return false}})()});return Response.json({error:'后台配置不完整，请联系管理员'},{status:503,headers:{'Cache-Control':'private, no-store'}})}
}
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE,handle as HEAD};
