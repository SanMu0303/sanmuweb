import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSupabase} from '../server/supabase/client.mjs';
import {createRepository} from '../server/supabase/repository.mjs';
import {createVideos} from '../server/supabase/videos.mjs';
const c=createSupabase();const repo=createRepository(c),handler=createVideos(c),id='video-qa-'+Date.now(),user={id:'video-acceptance',isAdmin:true};let upload;
const req=(path,data)=>new Request('https://sanmuweb.vercel.app'+path,{method:'PUT',body:JSON.stringify(data)});
try{
 const bytes=await readFile('/tmp/video-acceptance.mp4');
 upload=await (await handler.handle(new Request('https://sanmuweb.vercel.app/api/admin/video-uploads',{method:'POST',body:JSON.stringify({mimeType:'video/mp4',fileSize:bytes.length})}),user,repo)).json();
 const put=await fetch(upload.uploadUrl,{method:'PUT',headers:{'Content-Type':'video/mp4'},body:bytes});assert.ok(put.ok,'object upload '+put.status);
 const doc={id,revision:0,title:'临时视频验收',videoProvider:'selfHosted',uploadId:upload.id,duration:2,status:'published'};
 const saved=await(await handler.handle(req('/api/admin/videos',doc),user,repo)).json();assert.equal(saved.revision,1);
 const play=await handler.handle(new Request('https://sanmuweb.vercel.app/api/video-files/'+id),{isAdmin:false},repo);assert.equal(play.status,302);
 const stream=await fetch(play.headers.get('location'),{headers:{Range:'bytes=0-31'}});assert.equal(stream.status,206);assert.equal((await stream.arrayBuffer()).byteLength,32);
 await handler.handle(req('/api/admin/videos',{...doc,revision:1,isMemberOnly:true}),user,repo);
 await assert.rejects(handler.handle(new Request('https://sanmuweb.vercel.app/api/video-files/'+id),{isAdmin:false},repo),{status:404});
 console.log('PASS: real MP4 upload, persistence, signed playback, range request, member restriction');
}finally{
 await c.request('/rest/v1/videos?id=eq.'+id,{method:'DELETE'});
 if(upload){await c.request('/storage/v1/object/research-videos',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:['videos/'+upload.id]})});await c.request('/rest/v1/video_uploads?id=eq.'+upload.id,{method:'DELETE'})}
 console.log('temporary fixtures removed');
}
