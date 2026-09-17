import type {Video,Course,Lesson,LearningProgress} from './videos';
import type {Post} from './posts';
export type LibraryType='video'|'article'|'case';
export interface LibraryContent {id:string;type:LibraryType;title:string;description:string;thumbnail:string;category:string;tags:string[];topics:string[];isMemberOnly:boolean;publishedAt:string;updatedAt:string;courseId?:string;video?:Video;post?:Post;searchText:string}
export const courseHref=(id:string)=>'/courses/'+encodeURIComponent(id)+'/';
export const lessonHref=(l:Lesson)=>l.contentType==='video'?'/video/?id='+encodeURIComponent(l.contentId):'/article/?slug='+encodeURIComponent(l.contentId);
export function courseCount(c:Course){return {published:c.publishedLessons??c.chapters.reduce((n,ch)=>n+ch.lessons.length,0),total:c.totalLessons??c.chapters.reduce((n,ch)=>n+ch.lessons.length,0)}}
export function emptyProgress(courseId:string):LearningProgress{return {courseId,lessonId:null,progress:null,lastWatchedAt:null,lastPosition:null}}
export function videoCategories(videos:(Video&{status?:string;deletedAt?:string})[]){
 return [...new Set(videos.filter(v=>!v.deletedAt&&(!v.status||v.status==='published')).map(v=>v.category?.trim()||'').filter(Boolean))];
}
export function buildLibrary(videos:Video[],posts:Post[],courses:Course[]):LibraryContent[]{
 const courseText=(id:string)=>{const c=courses.find(c=>c.id===id);return c?c.title+' '+c.chapters.map(ch=>ch.title).join(' '):''};
 const videoItems:LibraryContent[]=videos.map(v=>({id:v.id,type:'video',title:v.title,description:v.description,thumbnail:v.thumbnail,category:v.category,tags:v.tags,topics:v.category?.trim()?[v.category.trim()]:[],isMemberOnly:v.isMemberOnly,publishedAt:v.publishedAt,updatedAt:v.updatedAt,courseId:v.courseId,video:v,searchText:[v.title,v.description,v.symbol,v.sector,...v.tags,v.category?.trim()||'',courseText(v.courseId)].join(' ')}));
 const notes:LibraryContent[]=posts.filter(p=>(p.format==='long'&&['教学内容','市场复盘','交易计划'].includes(p.contentType))||(p.symbol&&p.trendStage==='失效')).map(p=>{const type:LibraryType=p.contentType==='市场复盘'||p.trendStage==='失效'?'case':'article';const topics=[p.contentType];const c=courses.find(c=>c.chapters.some(ch=>ch.lessons.some(l=>l.contentId===p.slug||l.contentId===p.id)));return {id:p.id,type,title:p.statusText||p.title,description:p.summary||p.content[0]?.text||'',thumbnail:p.images[0]?.thumbnailUrl||p.images[0]?.url||'',category:p.contentType,tags:p.tags,topics,isMemberOnly:p.isMemberOnly,publishedAt:p.publishedAt,updatedAt:p.updatedAt,courseId:c?.id,post:p,searchText:[p.title,p.statusText,p.summary,p.symbol,p.market,p.sector,...p.tags,...topics,c?.title||''].join(' ')};});
 return [...videoItems,...notes];
}
export function filterLibrary(items:LibraryContent[],topic:string|null,type:string,query:string){const q=query.trim().toLocaleLowerCase();return items.filter(i=>(topic===null||i.topics.includes(topic))&&(type==='all'||i.type===type)&&(!q||i.searchText.toLocaleLowerCase().includes(q)))}
