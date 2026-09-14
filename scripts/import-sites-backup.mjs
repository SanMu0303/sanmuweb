// Validate every original before writing. Never silently replace existing data.
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createSupabase} from '../server/supabase/client.mjs';
const root=path.resolve(process.argv[2]||'.local/sites-backup-20260914');
const apply=process.argv.includes('--apply'),client=createSupabase();
const read=async name=>JSON.parse(await readFile(path.join(root,name+'.json'),'utf8'));
const articles=await read('articles'),watches=await read('watch_items'),images=await read('image_uploads');
for(const row of [...articles,...watches,...images]){if(typeof row.document==='string')row.document=JSON.parse(row.document)}
const required=images.filter(r=>articles.some(a=>(a.document.images||[]).some(i=>i.storagePath===r.storage_path)));
for(const row of required){
 if(!/^posts\/[a-f0-9-]{36}$/.test(row.storage_path))throw new Error('Unexpected object path');
 const file=path.join(root,'objects',row.storage_path);
 try{if((await stat(file)).size!==row.document.fileSize)throw new Error('Original image size mismatch: '+row.id)}catch(e){throw new Error('Original image missing or invalid: '+row.id,{cause:e})}
}
console.log(`Validated ${articles.length} articles, ${watches.length} watch items, ${required.length} originals`);
if(!apply){console.log('Validation only; add --apply after reviewing backup');process.exit(0)}
const users=await client.request('/auth/v1/admin/users?page=1&per_page=1000');
const admin=users.users.find(u=>u.email?.toLowerCase()===(process.env.ADMIN_EMAILS||'').split(',')[0].trim().toLowerCase()&&u.email_confirmed_at);
if(!admin)throw new Error('Confirmed administrator missing');
const options=body=>({method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});
// Empty-target check prevents overwriting any user-created records. Migration is
// intentionally stopped on partial runs so recovery can be reviewed explicitly.
for(const [table,key,rows]of [['articles','slug',articles],['watch_items','symbol',watches],['image_uploads','id',required]]){
 for(const row of rows){const found=await client.request('/rest/v1/'+table+'?'+new URLSearchParams({[key]:'eq.'+row[key],select:key}));if(found.length)throw new Error('Target already contains '+table+'/'+row[key])}
}
for(const row of required){
 await client.request('/storage/v1/object/'+client.config.bucket+'/'+row.storage_path,{method:'POST',headers:{'Content-Type':row.document.mimeType,'x-upsert':'false'},body:await readFile(path.join(root,'objects',row.storage_path))});
 await client.request('/rest/v1/image_uploads',options({...row,owner:admin.id}));
}
await client.request('/rest/v1/articles',options(articles));
await client.request('/rest/v1/watch_items',options(watches));
console.log('Import completed; compare records and image checksums before cutover');
