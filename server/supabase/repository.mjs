import {createSupabase} from './client.mjs';

const conflict=()=>Object.assign(new Error('内容已在其他窗口更新，请重新载入后合并。'),{status:409});
const tables={articles:'slug',watch_items:'symbol',videos:'id'};
const isEnded=document=>document?.observationStatus==='ended'||!!document?.endedAt;
const documentOf=row=>{
 if(!row)return null;
 const document={...row.document,revision:row.revision};
 // Legacy rows predate cycle ids.  Materialize their storage key as id while
 // retaining the original ticker as symbol; new rows already carry both.
 if(row.symbol&&(!document.id||typeof document.id!=='string'))document.id=row.symbol;
 if(row.symbol&&(!document.symbol||typeof document.symbol!=='string'))document.symbol=row.symbol;
 return document;
};
// All callers must authorize writes and validate documents before using this
// service-role repository. Raw documents must be projected before public reads.
export function createRepository(client=createSupabase()) {
 function keyFor(table){if(!Object.hasOwn(tables,table))throw new Error('Unsupported content table');return tables[table]}
 function query(table,params){keyFor(table);return '/rest/v1/'+table+'?'+new URLSearchParams(params)}
 return {
  async list(table,{publishedOnly=false}={}) {
   const key=keyFor(table),all=[];
   // Explicit pagination avoids Supabase's response row cap losing old posts.
   for(let offset=0;;offset+=500){
    const rows=await client.request(query(table,{select:'*',order:key+'.asc',limit:'500',offset:String(offset),...(publishedOnly&&table==='articles'?{status:'eq.published'}:{})}));
    all.push(...rows.map(documentOf));if(rows.length<500)return all;
   }
  },
  async get(table,key,{publishedOnly=false}={}) {
   const column=keyFor(table),filters=publishedOnly&&table==='articles'?{status:'eq.published'}:{};
   const rows=await client.request(query(table,{select:'*',[column]:'eq.'+key,limit:'1',...filters}));
   return documentOf(rows[0]);
  },
  async history(symbol){
   // Keep the legacy ticker query fast and compatible.  If it has no history,
   // resolve the active cycle id and retry against its storage key.
   const read=async storageKey=>{const all=[];for(let offset=0;;offset+=500){const rows=await client.request('/rest/v1/watch_history?'+new URLSearchParams({symbol:'eq.'+storageKey,select:'document,revision,recorded_at',order:'revision.desc',limit:'500',offset:String(offset)}));all.push(...rows);if(rows.length<500)return all;}};
   const direct=await read(symbol);if(direct.length)return direct;
   const row=await this.get('watch_items',symbol);if(!row?.id||row.id===symbol)return direct;
   return read(row.id);
  },
  async archive(table,key,expectedRevision,restore=false) {
   if(!['watch_items','videos'].includes(table)||!Number.isInteger(expectedRevision)||expectedRevision<0)throw new Error('Invalid archive request');
   if(table==='watch_items'){
   const rows=await client.request('/rest/v1/rpc/archive_research_watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_id:key,p_revision:expectedRevision,p_restore:restore})});
    // A few lightweight adapters used by older deployments do not expose the
    // RPC yet and return a PostgREST-style row array.  Keep the optimistic
    // PATCH fallback so those adapters remain backwards compatible; production
    // Supabase returns the JSON document directly from the RPC.
    if(!Array.isArray(rows))return documentOf({document:rows,revision:rows?.revision});
   }
   const current=await this.get(table,key);if(!current)throw Object.assign(new Error('记录不存在'),{status:404});
   if(current.revision!==expectedRevision)throw conflict();
   const {revision,...document}=current;
   if(restore)delete document.deletedAt;else document.deletedAt=new Date().toISOString();
   document.updatedAt=table==='watch_items'?new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}):new Date().toISOString();
   if(table==='watch_items')document.isWeeklyFocus=false;else document.status='draft';
   const rows=await client.request(query(table,{[keyFor(table)]:'eq.'+key,revision:'eq.'+expectedRevision}),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({document,revision:expectedRevision+1})});
   if(rows.length!==1)throw conflict();return documentOf(rows[0]);
  },
  async saveWithWatch(document,revision,owner,sync){
   return client.request('/rest/v1/rpc/save_post_with_watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_document:document,p_revision:revision,p_owner:owner,p_sync:sync})});
  },
  async save(table,document,expectedRevision,owner) {
   const column=keyFor(table);
   // A newly-created cycle must never reuse the ticker as its storage key: an
   // ended or recycled cycle may still occupy that legacy key.  Keep callers
   // that already loaded a cycle id unchanged and generate one only for a new
   // document.
   if(table==='watch_items'&&!document.id&&expectedRevision===0){
    const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    document={...document,id};
   }
   const key=table==='watch_items'?(document.id||document.symbol):document[column];
   if(typeof key!=='string'||!key||!Number.isInteger(expectedRevision)||expectedRevision<0)throw new Error('Invalid document identity or revision');
   if(table==='watch_items'&&owner){
    if(!owner)throw new Error('图片关联事务需要已验证的管理员身份');
    return client.request('/rest/v1/rpc/save_research_watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_document:document,p_revision:expectedRevision,p_owner:owner})});
   }
   if(table==='articles'&&owner){
    return client.request('/rest/v1/rpc/save_research_article',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_document:document,p_revision:expectedRevision,p_owner:owner})});
   }
   if(document.images?.some(i=>i.storagePath||i.url?.startsWith('/api/images/')))throw new Error('图片关联事务需要已验证的管理员身份');
   const {revision:ignored,...clean}=document;
   const row={[column]:key,document:clean,revision:expectedRevision+1,...(table==='articles'?{status:clean.status,published_at:clean.publishedAt}:{})};
   let rows;
   try {
    rows=await client.request(expectedRevision===0?'/rest/v1/'+table:query(table,{[column]:'eq.'+key,revision:'eq.'+expectedRevision}),{
     method:expectedRevision===0?'POST':'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(row)
    });
   }catch(error){if(error.status===409)throw conflict();throw error}
   if(rows.length!==1)throw conflict();
   return documentOf(rows[0]);
  }
 };
}
