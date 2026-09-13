// Shared compatibility adapter: array order is authoritative for old and new records.
export function normalizeImages(input={}){
 const list=Array.isArray(input)?input:Array.isArray(input.images)?input.images:Array.isArray(input.imageUrls)?input.imageUrls:input.imageUrl?[input.imageUrl]:[];
 return list.map((value,index)=>{const i=typeof value==='string'?{url:value}:value;if(!i?.url)return null;return {...i,id:i.id||`legacy-${index}`,url:i.url,thumbnailUrl:i.thumbnailUrl||i.url,storagePath:i.storagePath||'',width:i.width||0,height:i.height||0,mimeType:i.mimeType||'',fileSize:i.fileSize||0,sortOrder:index,alt:i.alt||'研究配图',isPreview:i.isPreview===true};}).filter(Boolean);
}
