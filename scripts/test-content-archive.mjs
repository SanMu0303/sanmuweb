import assert from 'node:assert/strict';
import {createSupabase} from '../server/supabase/client.mjs';
import {createRepository} from '../server/supabase/repository.mjs';
import {createApi} from '../server/supabase/api.mjs';
const c=createSupabase(),repo=createRepository(c),stamp=Date.now(),symbol='ARCHIVEQA'+stamp,id='video-archiveqa-'+stamp;
const api=createApi({repo,auth:{identify:async()=>({id:'archive-qa',isAdmin:true,signedIn:true})}});
const call=async(path,method,body)=>{const res=await api(new Request('https://sanmuweb.vercel.app'+path,{method,headers:{origin:'https://sanmuweb.vercel.app','Content-Type':'application/json'},body:JSON.stringify(body)}));const d=await res.json();assert.equal(res.status,200,JSON.stringify(d));return d};
try{
 await repo.save('watch_items',{symbol,name:'临时回收站验收',market:'跨市场',stage:'准备',thesis:'仅用于验收',invalidation:'测试结束',updatedAt:'2026-09-16',images:[],isWeeklyFocus:false,articleSlug:''},0,'archive-qa');
 const w=await call('/api/admin/watchlist','DELETE',{symbol,revision:1});assert.ok(w.deletedAt);assert.equal(w.isWeeklyFocus,false);const history=await repo.history(symbol);assert.equal(history.length,2);assert.equal(history.some(h=>h.revision===1&&!h.document.deletedAt),true);
 const restored=await call('/api/admin/watchlist','PATCH',{symbol,revision:2});assert.equal(restored.deletedAt,undefined);assert.match(restored.updatedAt,/^\d{4}-\d{2}-\d{2}$/);
 await repo.save('videos',{id,title:'临时视频删除验收',status:'published',videoUrl:'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',videoProvider:'youtube'},0);
 const v=await call('/api/admin/videos','DELETE',{id,revision:1});assert.ok(v.deletedAt);assert.equal(v.status,'draft');assert.equal(v.videoUrl,'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ');const r=await call('/api/admin/videos','PATCH',{id,revision:2});assert.equal(r.deletedAt,undefined);assert.equal(r.status,'draft');
 console.log('PASS: real database delete/restore for watch and video; history and source preserved');
}finally{await c.request('/rest/v1/watch_items?symbol=eq.'+symbol,{method:'DELETE'});await c.request('/rest/v1/watch_history?symbol=eq.'+symbol,{method:'DELETE'});await c.request('/rest/v1/videos?id=eq.'+id,{method:'DELETE'});console.log('Only generated fixtures cleaned')}
