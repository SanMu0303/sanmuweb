"use client";
import {useState} from 'react';
import {useResource} from '@/lib/live';
import type {Video,Course} from '@/lib/videos';
import type {Post} from '@/lib/posts';
import {LEARNING_TOPICS,buildLibrary,filterLibrary,courseCount,courseHref,lessonHref,emptyProgress} from '@/lib/library';
import LibraryVideoCard from './LibraryVideoCard';
import CourseOutline from './CourseOutline';
import CourseDirectorySheet from './CourseDirectorySheet';
import ResourceState from './ResourceState';
import './learning-library.css';
export default function KnowledgeLibrary(){
 const [topic,setTopic]=useState('全部'),[type,setType]=useState('all'),[query,setQuery]=useState('');
 const library=useResource<{videos:Video[];courses:Course[]}>('/api/library');const posts=useResource<Post[]>('/api/posts');
 if(!library.data||!posts.data||library.error||posts.error)return <ResourceState error={library.error||posts.error} retry={()=>{library.retry();posts.retry()}}/>;
 const {videos,courses}=library.data;const current=courses[0];const count=current?courseCount(current):null;const progress=current?emptyProgress(current.id):null;
 const first=current?.chapters[0]?.lessons[0];const filtered=filterLibrary(buildLibrary(videos,posts.data,courses),topic,type,query);
 const videoItems=filtered.filter(i=>i.type==='video'),articles=filtered.filter(i=>i.type==='article'),cases=filtered.filter(i=>i.type==='case');
 const outline=current?<CourseOutline course={current} videos={videos} posts={posts.data}/>:null;
 return <div className="learning-library"><header className="learning-header"><div><h1>知识库 / 课程</h1><p>系统学习趋势交易，也按主题查找方法与案例。</p></div><div className="learning-search"><input aria-label="搜索课程资料" placeholder="搜索视频、课程、标签或标的" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="内容类型筛选" value={type} onChange={e=>setType(e.target.value)}><option value="all">全部内容</option><option value="video">视频</option><option value="article">文章</option><option value="case">案例</option></select></div></header>
 <nav className="learning-topics" aria-label="学习主题">{LEARNING_TOPICS.map(t=><button key={t} aria-pressed={topic===t} className={topic===t?'selected':''} onClick={()=>setTopic(t)}>{t}</button>)}</nav>
 <div className="learning-layout"><div className="learning-main">{current&&<><div className="learning-resume"><span>继续学习</span><p>{progress?.lastWatchedAt?'返回上次学习位置':'暂无观看记录'} <small>进度同步待接入</small></p>{first&&<a href={lessonHref(first)}>开始学习 →</a>}</div><section className="learning-current"><div><small>当前课程 · 示例系列</small><h2>{current.title}</h2><p>{current.chapters[0]?.title}</p></div><div><span>已更新 {count?.published} / {count?.total} 课</span><a href={courseHref(current.id)}>进入课程 →</a></div></section></>}
 <CourseDirectorySheet>{outline}</CourseDirectorySheet>
 <div className="learning-results" aria-live="polite">{videoItems.length>0&&<section><div className="learning-section-heading"><h2>视频档案</h2><span>{videoItems.length} 个视频</span></div><div className="archive-video-grid">{videoItems.map(i=><LibraryVideoCard key={i.id} video={i.video!} course={courses.find(c=>c.id===i.courseId)}/>)}</div></section>}
 {articles.length>0&&<section className="learning-text-section"><div className="learning-section-heading"><h2>文章与方法笔记</h2><span>{articles.length} 篇</span></div>{articles.map(i=><a className="learning-note" key={i.id} href={'/article/?slug='+encodeURIComponent(i.post!.slug)}><small>{i.category} · {i.isMemberOnly?'会员':'公开'}</small><h3>{i.title}</h3><p>{i.description}</p></a>)}</section>}
 {cases.length>0&&<section className="learning-text-section"><div className="learning-section-heading"><h2>实战资料 / 案例</h2><span>{cases.length} 条</span></div>{cases.map(i=><a className="learning-case" key={i.id} href={'/article/?slug='+encodeURIComponent(i.post!.slug)}><div><b>{i.post!.symbol||'市场复盘'}</b><span>{i.post!.market}</span>{i.post!.trendStage&&<span>{i.post!.trendStage}</span>}<time>{i.updatedAt.slice(0,10)}</time></div><h3>{i.title}</h3><p>{i.description}</p><small>{i.tags.map(t=>'#'+t).join('　')}</small></a>)}</section>}
 {!filtered.length&&<div className="learning-empty"><p>暂无匹配资料，试试其他主题或关键词。</p><button onClick={()=>{setTopic('全部');setType('all');setQuery('')}}>清除筛选</button></div>}</div>
 </div><aside className="learning-rail">{outline}</aside></div></div>;
}
