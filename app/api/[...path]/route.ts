import {createApi} from '@/server/supabase/api.mjs';
import videos from '@/content/videos.json';
import courses from '@/content/courses.json';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request){
 try{return await createApi({videos,courses})(request)}catch{return Response.json({error:'后台配置不完整，请联系管理员'},{status:503,headers:{'Cache-Control':'private, no-store'}})}
}
export {handle as GET,handle as POST,handle as PUT,handle as DELETE,handle as HEAD};
