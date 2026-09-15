import {createSupabase} from './client.mjs';

const conflict=()=>Object.assign(new Error('内容已在其他窗口更新，请重新载入后合并。'),{status:409});
const tables={articles:'slug',watch_items:'symbol'};
const documentOf=row=>row?{...row.document,revision:row.revision}:null;
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
   const rows=await client.request(query(table,{select:'*',[keyFor(table)]:'eq.'+key,limit:'1',...(publishedOnly&&table==='articles'?{status:'eq.published'}:{})}));
   return documentOf(rows[0]);
  },
  async saveWithWatch(document,revision,owner,sync){
   return client.request('/rest/v1/rpc/save_post_with_watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_document:document,p_revision:revision,p_owner:owner,p_sync:sync})});
  },
  async save(table,document,expectedRevision,owner) {
   const column=keyFor(table),key=document[column];
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
