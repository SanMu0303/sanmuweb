// Read-only connectivity/schema check; never prints credentials or database rows.
import {createSupabase} from '../server/supabase/client.mjs';
try {
 const client=createSupabase();
 for(const table of ['articles','watch_items','cms_meta','image_uploads']) {
  await client.request('/rest/v1/'+table+'?select=*&limit=0');
  console.log(table+': accessible');
 }
 const bucket=await client.request('/storage/v1/bucket/'+encodeURIComponent(client.config.bucket));
 if(bucket.public!==false)throw new Error('图片桶必须设为私有');
 console.log('Private image bucket: verified');
}catch(error){console.error(error.message);process.exitCode=1}
