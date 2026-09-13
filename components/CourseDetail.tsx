"use client";
import {useResource} from '@/lib/live';
import type {Video,Course} from '@/lib/videos';
import type {Post} from '@/lib/posts';
import {courseCount,lessonHref} from '@/lib/library';
import {durationLabel} from '@/lib/videos';
import ResourceState from './ResourceState';
import './learning-library.css';
export default function CourseDetail({courseId}:{courseId:string}){
 const library=useResource<{videos:Video[];courses:Course[]}>('/api/library'),posts=useResource<Post[]>('/api/posts');
 if(!library.data||!posts.data||library.error||posts.error)return <ResourceState error={library.error||posts.error} retry={()=>{library.retry();posts.retry()}}/>;
 const course=library.data.courses.find(c=>c.id===courseId);if(!course)return <div className="empty">课程不存在 <a href="/knowledge/">返回课程中心</a></div>;const count=courseCount(course);
 return <div className="learning-library course-detail-page"><a className="course-back" href="/knowledge/">← 知识库 / 课程</a><header className="learning-header"><div><h1>{course.title}</h1><p>{course.description}</p></div><small>已更新 {count.published} / {count.total} 课 · 示例系列</small></header>{[...course.chapters].sort((a,b)=>(a.order||0)-(b.order||0)).map(ch=><section className="course-chapter" key={ch.id}><h2>{ch.title}</h2>{[...ch.lessons].sort((a,b)=>(a.order||0)-(b.order||0)).map((l,index)=>{const video=library.data!.videos.find(v=>v.id===l.contentId),post=posts.data!.find(p=>p.id===l.contentId||p.slug===l.contentId);return <a key={l.id} className="course-lesson" href={lessonHref(l)}><span>{String(index+1).padStart(2,'0')}</span><small>{l.contentType==='video'?'视频':'文章'}</small><b>{video?.title||post?.title||l.contentId}</b><small>{video?durationLabel(video.duration):'文字补充'}</small><span>↗</span></a>})}</section>)}</div>
}
