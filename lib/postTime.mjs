export const POST_TIME_ZONE='Asia/Shanghai';
function parse(value){
 if(!value)return null;
 let normalized=value;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))normalized=value+'T00:00:00+08:00';
 else if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value))normalized=value.replace(' ','T')+'+08:00';
 const date=new Date(normalized);return Number.isNaN(date.getTime())?null:date;
}
export function formatPostTime(updatedAt,publishedAt,full=false){
 const date=parse(updatedAt)||parse(publishedAt);if(!date)return '时间未记录';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:POST_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${full?parts.year+'-':''}${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
