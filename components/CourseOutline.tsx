import type {Course,Video} from '@/lib/videos';
import type {Post} from '@/lib/posts';
import {courseHref,courseCount,lessonHref} from '@/lib/library';
export default function CourseOutline({course,videos,posts}:{course:Course;videos:Video[];posts:Post[]}){
 const chapter=[...course.chapters].sort((a,b)=>(a.order||0)-(b.order||0))[0];const count=courseCount(course);
 return <div className="series-outline"><small>当前系列</small><h2>{course.title}</h2><p>已更新 {count.published} / {count.total} 课</p>{chapter&&<><h3>{chapter.title}</h3><ol>{[...chapter.lessons].sort((a,b)=>(a.order||0)-(b.order||0)).slice(0,4).map((l,i)=><li key={l.id}><a href={lessonHref(l)}><span>{String(i+1).padStart(2,'0')}</span><span>{videos.find(v=>v.id===l.contentId)?.title||posts.find(p=>p.slug===l.contentId)?.title||l.contentId}</span></a></li>)}</ol></>}<a className="full-directory-link" href={courseHref(course.id)}>查看完整目录 →</a></div>
}
