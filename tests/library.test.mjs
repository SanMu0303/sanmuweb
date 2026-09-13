import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLibrary,filterLibrary,courseCount,emptyProgress,lessonHref} from '../lib/library.ts';
const read=name=>JSON.parse(readFileSync(new URL('../content/'+name+'.json',import.meta.url),'utf8'));
const videos=read('videos'),courses=read('courses'),posts=read('posts');
test('learning topics and search span video, notes and cases',()=>{
 const items=buildLibrary(videos,posts,courses);
 const doge=filterLibrary(items,'全部','all','DOGE');assert(doge.some(i=>i.type==='video'));assert(doge.some(i=>i.type==='case'));
 assert(filterLibrary(items,'风险管理','all','').some(i=>i.type==='video'));
 assert(filterLibrary(items,'风险管理','all','').some(i=>i.type==='article'));
 assert(filterLibrary(items,'全部','video','趋势交易课').length===6);
 assert(filterLibrary(items,'全部','case','DOGE').every(i=>i.type==='case'));
 assert.equal(filterLibrary(items,'买点体系','all','').some(i=>i.id==='three-entries'),true);
});
test('course hierarchy has stable identifiers, ordered mixed lessons and honest progress placeholders',()=>{
 const c=courses[0];assert.deepEqual(courseCount(c),{published:7,total:7});
 assert(c.chapters.every(ch=>ch.courseId===c.id&&ch.lessons.every(l=>l.chapterId===ch.id&&l.type===l.contentType&&l.order>0)));
 const lessons=c.chapters.flatMap(ch=>ch.lessons);assert(lessonHref(lessons[5]).startsWith('/article/'));assert(lessonHref(lessons[6]).startsWith('/video/'));
 for(const v of videos)assert.equal(lessons[v.lessonNumber-1].contentId,v.id);
 assert.equal(emptyProgress(c.id).progress,null);assert.equal(emptyProgress(c.id).lastWatchedAt,null);
});
