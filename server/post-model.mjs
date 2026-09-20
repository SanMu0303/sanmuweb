import {normalizeImages} from './image-model.mjs';
// Pure adapter. Existing Article documents remain readable; new fields are additive.
export const CONTENT_TYPES=['观察更新','交易计划','交易反馈','市场复盘','教学内容'];
export const MARKETS=['美股','加密','A股','黄金','外汇','跨市场'];
export const STAGES=['准备','启动','运行','高潮','失效'];
const mapping={'趋势观察':'观察更新','交易计划':'交易计划','市场复盘':'市场复盘','趋势课程':'教学内容'};
const marketMap={'A 股':'A股','加密市场':'加密','全球市场':'黄金'};
const managedImageUrl=value=>typeof value==='string'&&/^\/api\/images\/[a-f0-9-]{36}$/.test(value);
const presentationImage=image=>{
  if(!image||typeof image!=='object')return image;
  const {id,url,thumbnailUrl,width,height,mimeType,fileSize,sortOrder,alt,caption,isPreview}=image;
  return {id,url,thumbnailUrl,width,height,mimeType,fileSize,sortOrder,alt,caption,isPreview};
};
const memberPrompt = {
  label: '会员专享',
  title: '会员专享 · 完整研究记录',
  description: '',
  cta: '开通会员',
};
// Deliberately fixed, non-semantic glyphs. These rows never derive their
// length or characters from the protected body, so they cannot be used to
// reconstruct member-only text from the response.
const memberMaskedLines = [
  '••••••••••••••••••••••',
  '••••••••••••••••',
  '••••••••••••••••••••••••',
  '••••••••••••••••••',
  '••••••••••••••••••••••',
];

const safePreview=value=>{
  if(typeof value!=='string')return '';
  const lines=value.replace(/\r/g,'').split(/\n|(?<=[。！？!?])/).map(v=>v.trim()).filter(Boolean);
  const unsafe=/(?:做多|做空|买入|卖出|开仓|平仓|入场|进场|止盈|止损|仓位|目标价|价格|价位|突破|跌破|挂单|杠杆|合约|\b(?:long|short|entry|stop(?:loss)?|take\s*profit|position|leverage|buy|sell)\b|\d+(?:\.\d+)?\s*(?:%|倍|美元|USDT|USD|CNY|元|点)?)/i;
  return lines.filter(line=>!unsafe.test(line)).join(' ').slice(0,320).trim();
};
const safePublicTitle=value=>{
  if(typeof value!=='string')return '';
  const text=value.replace(/\s+/g,' ').trim();
  if(!text||text.length>100)return '';
  const unsafe=/(?:做多|做空|买入|卖出|开仓|平仓|入场|进场|止盈|止损|仓位|目标价|价格|价位|突破|跌破|挂单|杠杆|合约|\b(?:long|short|entry|stop(?:loss)?|take\s*profit|position|leverage|buy|sell)\b|\d+(?:\.\d+)?\s*(?:%|倍|美元|USDT|USD|CNY|元|点)?)/i;
  return unsafe.test(text)?'':text;
};
export function normalizePost(a){
 const access=a.access==='member'||a.isMemberOnly===true?'member':a.access==='preview'?'preview':'public';
 const restricted=access!=='public';
 const sections=Array.isArray(a.sections)?a.sections:Array.isArray(a.content)?a.content:[];
 return {id:a.id||a.slug,slug:a.slug,title:a.title,publicTitle:a.publicTitle??'',summary:a.excerpt??a.summary??'',preview:a.preview??a.publicSummary??'',content:sections,contentType:a.contentType||mapping[a.category]||'观察更新',format:a.format||'long',symbol:(a.symbol||'').trim().toUpperCase(),market:marketMap[a.market]||a.market||'跨市场',sector:a.sector||'',trendStage:a.trendStage||null,status:a.status||'published',statusText:a.statusText||'',timeframe:a.timeframe||'',tags:a.tags||[],images:normalizeImages(a),access,isMemberOnly:restricted,isPublic:!restricted,publishedAt:a.publishedAtTime||(a.publishedAt.length===10?a.publishedAt+'T10:00:00+08:00':a.publishedAt),updatedAt:a.updatedAt||a.publishedAtTime||(a.publishedAt.length===10?a.publishedAt+'T10:00:00+08:00':a.publishedAt),author:a.author||{id:'sanmu',name:'三木'},readTime:a.readMinutes||3,tradeId:a.tradeId||null,watchlistId:a.watchlistId||null,relatedPosts:a.relatedPosts||[],isExample:a.isExample===true,locked:false,revision:a.revision||1};
}
export function projectPost(a,canReadMembers=false){
 const p=normalizePost(a);
 if(p.isMemberOnly&&!canReadMembers){
  // Only the explicitly public preview block is projected. Never send later
  // sections, private storage metadata, or a member original image.
  const first=p.content[0];
  // `preview`/`excerpt` are the editor's public-safe fields. Preserve the
  // legacy first block only when it is explicitly labelled 预览.
  const previewHeading=/^(?:公开)?预览$|^public\s+preview$/i.test((first?.heading||'').trim());
  const preview=safePreview((p.preview||'').trim()||(previewHeading?first?.text||'':''));
  // Short-post titles were historically copied from the first body line.
  // Do not let titles, status notes or relationships bypass body projection.
  p.symbol=/^[A-Z0-9._-]{1,20}$/.test(p.symbol)?p.symbol:'';
  p.publicTitle=safePublicTitle(p.publicTitle);
  p.title=p.publicTitle||`${p.symbol||'标的'} · 研究更新`;
  p.statusText='';
  p.sector='';
  p.timeframe='';
  p.tags=p.tags.filter(tag=>safePreview(tag)===tag);
  p.tradeId=null;p.watchlistId=null;p.relatedPosts=[];
  p.content=preview?[{heading:'',text:preview.slice(0,320)}]:[];
  p.summary=preview.slice(0,320);
  p.preview=preview.slice(0,320);
  p.images=p.images.filter(i=>i.isPreview===true&&!managedImageUrl(i.url)&&!managedImageUrl(i.thumbnailUrl)).slice(0,1).map(i=>({...presentationImage(i),alt:'公开预览图',caption:''}));
  p.locked=true;
  p.access='member_required';
  p.memberPrompt={...memberPrompt};
  p.maskedLines=[...memberMaskedLines];
 }
 p.images=p.images.map(presentationImage);
 return p;
}
export function filterPosts(posts,f={}){const query=(f.query||'').trim().toLowerCase();return posts.filter(p=>(!f.contentType||p.contentType===f.contentType)&&(!f.market||p.market===f.market)&&(!f.stage||p.trendStage===f.stage)&&(!f.symbol||p.symbol.toUpperCase()===f.symbol.toUpperCase())&&(!f.tag||p.tags.includes(f.tag))&&(!f.month||p.publishedAt.slice(0,7)===f.month)&&(!query||[p.title,p.summary,...p.content.map(b=>b.heading+' '+b.text),p.symbol,p.sector,...p.tags].join(' ').toLowerCase().includes(query)));}
export function orderPosts(posts,chronological=false){return [...posts].sort((a,b)=>(chronological?Date.parse(a.publishedAt)-Date.parse(b.publishedAt):Date.parse(b.updatedAt)-Date.parse(a.updatedAt))||a.id.localeCompare(b.id));}

export function toArticleDocument(p){
 const document={id:p.id,slug:p.slug,title:p.title,publicTitle:p.publicTitle,excerpt:p.summary,preview:p.preview,sections:p.content,category:({'观察更新':'趋势观察','交易反馈':'趋势观察','交易计划':'交易计划','市场复盘':'市场复盘','教学内容':'趋势课程'}[p.contentType]),contentType:p.contentType,format:p.format,symbol:p.symbol,market:p.market,sector:p.sector,trendStage:p.trendStage,status:p.status,statusText:p.statusText,timeframe:p.timeframe,tags:p.tags,images:p.images,pinned:p.isPinned,access:p.access,publishedAt:p.publishedAt.slice(0,10),publishedAtTime:p.publishedAt,updatedAt:p.updatedAt,author:p.author,readMinutes:p.readTime,tradeId:p.tradeId,watchlistId:p.watchlistId,relatedPosts:p.relatedPosts,isExample:p.isExample};
 if(p.locked){document.maskedLines=p.maskedLines;document.memberPrompt=p.memberPrompt;}
 return document;
}
