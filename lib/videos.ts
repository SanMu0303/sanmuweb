export type VideoProvider='youtube'|'bilibili'|'selfHosted'|'cdn';
export interface Video {id:string;contentType:'video';title:string;description:string;videoUrl:string;previewUrl?:string;videoProvider:VideoProvider;thumbnail:string;duration:number;category:string;chapter:string;courseId:string;tags:string[];symbol:string;market:string;sector:string;isMemberOnly:boolean;publishedAt:string;updatedAt:string;relatedPosts:string[];relatedVideos:string[];isExample:boolean;locked?:boolean}
export interface Lesson {id:string;contentType:'video'|'article';contentId:string}
export interface Chapter {id:string;title:string;lessons:Lesson[]}
export interface Course {id:string;title:string;description:string;chapters:Chapter[]}
export const videoHref=(id:string)=>'/video/?id='+encodeURIComponent(id);
export const durationLabel=(seconds:number)=>Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
// Additive course metadata; legacy contentType/chapter fields remain compatible.
export interface Video {chapterId?:string;lessonNumber?:number;topics?:string[];coverUploadId?:string}
export interface Lesson {chapterId?:string;order?:number;type?:'video'|'article'}
export interface Chapter {courseId?:string;order?:number}
export interface Course {thumbnail?:string;totalLessons?:number;publishedLessons?:number}
export interface LearningProgress {courseId:string;lessonId:string|null;progress:number|null;lastWatchedAt:string|null;lastPosition:number|null}
