// A reconnect, historical refresh or first snapshot establishes a new baseline.
export function freshEvents(previousIds, items, {reason, lastSuccess, now=Date.now()}) {
  if(reason!=='poll'||!lastSuccess||now-lastSuccess>90_000)return [];
  return items.filter(item=>!previousIds.has(item.id)&&Date.parse(item.publishedAt)>lastSuccess&&Date.parse(item.publishedAt)<=now+5_000&&now-Date.parse(item.publishedAt)<90_000);
}
export function mergeEvents(current,incoming,limit=300) {
  const unique=new Map(current.map(item=>[item.id,item]));
  for(const item of incoming)if(item.id)unique.set(item.id,item);
  return [...unique.values()].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)||a.id.localeCompare(b.id)).slice(0,limit);
}
export function matchesReminder(event,panel,sources) {
  if(panel!=='selected')return true;
  return sources.some(source=>source.enabled&&source.sound&&source.id===event.sourceId&&(!source.keywords||source.keywords.split(/[,，]/).filter(Boolean).some(word=>(event.title+' '+event.summary).toLowerCase().includes(word.trim().toLowerCase()))));
}
