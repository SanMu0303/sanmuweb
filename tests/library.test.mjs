import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLibrary,filterLibrary,videoCategories,courseCount,emptyProgress,lessonHref} from '../lib/library.ts';

const timestamp='2026-09-17T00:00:00Z';
const video=(id,overrides={})=>({
 id,contentType:'video',title:'视频 '+id,description:'',videoUrl:'',videoProvider:'selfHosted',thumbnail:'',duration:90,
 category:'',chapter:'',courseId:'',tags:[],symbol:'',market:'',sector:'',isMemberOnly:false,publishedAt:timestamp,updatedAt:timestamp,
 relatedPosts:[],relatedVideos:[],isExample:false,...overrides,
});
const post=(id,overrides={})=>({
 id,slug:id,title:'笔记 '+id,summary:'',content:[{heading:'',text:'正文'}],contentType:'教学内容',format:'long',symbol:'',market:'',sector:'',
 trendStage:null,status:'published',statusText:'',timeframe:'',tags:[],images:[],isPinned:false,isMemberOnly:false,isPublic:true,
 publishedAt:timestamp,updatedAt:timestamp,author:{id:'author',name:'作者'},readTime:1,tradeId:null,watchlistId:null,relatedPosts:[],
 isExample:false,locked:false,revision:1,...overrides,
});
const course={
 id:'custom-course',title:'自建课程',description:'独立测试课程',chapters:[
  {id:'first-chapter',title:'自定义章节',courseId:'custom-course',order:1,lessons:[
   {id:'lesson-video',chapterId:'first-chapter',contentType:'video',type:'video',contentId:'custom-video',order:1},
   {id:'lesson-note',chapterId:'first-chapter',contentType:'article',type:'article',contentId:'custom-note',order:2},
  ]},
  {id:'next-chapter',title:'后续章节',courseId:'custom-course',order:2,lessons:[
   {id:'lesson-review',chapterId:'next-chapter',contentType:'article',type:'article',contentId:'custom-review',order:1},
  ]},
 ],
};

test('video categories follow published custom categories in first-seen order',()=>{
 const videos=[
  video('first',{category:'  自定义复盘  '}),
  video('blank',{category:' \n\t '}),
  video('second',{category:'期权入门',status:'published'}),
  video('duplicate',{category:'自定义复盘'}),
  video('removed',{category:'已删除分类',deletedAt:timestamp}),
  video('draft',{category:'草稿分类',status:'draft'}),
  video('third',{category:' 外汇跟踪 ',deletedAt:null}),
  video('empty',{category:''}),
 ];
 const before=structuredClone(videos);
 assert.deepEqual(videoCategories(videos),['自定义复盘','期权入门','外汇跟踪']);
 assert.deepEqual(videos,before,'category normalization must not mutate source records');
 assert.deepEqual(videoCategories([video('draft-only',{category:'草稿',status:'draft'}),video('deleted-only',{category:'回收站',deletedAt:timestamp})]),[]);
});

test('custom video categories drive filtering without inherited example topics',()=>{
 const items=buildLibrary([
  video('custom-video',{category:'  自定义复盘  ',topics:['趋势基础','买点体系']}),
  video('another-video',{category:'期权入门'}),
  video('uncategorized',{category:'  ',topics:['趋势基础']}),
 ],[],[]);
 assert.deepEqual(items.find(i=>i.id==='custom-video').topics,['自定义复盘']);
 assert.deepEqual(items.find(i=>i.id==='uncategorized').topics,[]);
 assert.deepEqual(filterLibrary(items,'自定义复盘','video','').map(i=>i.id),['custom-video']);
 assert.deepEqual(filterLibrary(items,'趋势基础','all',''),[]);
 assert.deepEqual(filterLibrary(items,null,'video','自定义复盘').map(i=>i.id),['custom-video']);
});

test('a custom category named 全部 remains distinct from the unfiltered selection',()=>{
 const videos=[video('named-all',{category:'全部'}),video('other-category',{category:'期权入门'})];
 const items=buildLibrary(videos,[],[]);
 assert.deepEqual(videoCategories(videos),['全部','期权入门']);
 assert.deepEqual(filterLibrary(items,'全部','video','').map(i=>i.id),['named-all']);
 assert.deepEqual(filterLibrary(items,null,'video','').map(i=>i.id),['named-all','other-category']);
});

test('keyword search spans independent video, article, case and course metadata',()=>{
 const items=buildLibrary([
  video('custom-video',{title:'SOL 技术分享',description:'仓位核算示例',category:'策略实验',tags:['突破回测'],symbol:'SOL',sector:'链上应用',courseId:course.id}),
  video('second-video',{title:'外汇观察',category:'市场观察'}),
 ],[
  post('custom-note',{title:'执行笔记',summary:'SOL 条件记录',tags:['执行清单']}),
  post('custom-review',{contentType:'市场复盘',title:'SOL 周末复盘',symbol:'SOL',market:'加密'}),
 ],[course]);
 assert.deepEqual(filterLibrary(items,null,'all','  sOl  ').map(i=>i.type),['video','article','case']);
 for(const keyword of ['仓位核算','突破回测','链上应用','自建课程','自定义章节','策略实验']){
  assert.deepEqual(filterLibrary(items,null,'video',keyword).map(i=>i.id),['custom-video'],keyword);
 }
 assert.deepEqual(filterLibrary(items,null,'article','执行清单').map(i=>i.id),['custom-note']);
 assert.deepEqual(filterLibrary(items,null,'case','SOL').map(i=>i.id),['custom-review']);
 assert.deepEqual(filterLibrary(items,'策略实验','video','外汇'),[]);
 assert.deepEqual(filterLibrary(items,null,'all','不存在的关键词'),[]);
});

test('article topics use their own content type instead of example slug mappings',()=>{
 const items=buildLibrary([], [
  post('custom-note',{slug:'three-entries',contentType:'教学内容'}),
  post('custom-review',{slug:'doge-0910',contentType:'市场复盘'}),
  post('custom-plan',{slug:'risk-plan',contentType:'交易计划'}),
 ],[]);
 assert.deepEqual(items.map(i=>i.topics),[['教学内容'],['市场复盘'],['交易计划']]);
 assert.deepEqual(filterLibrary(items,'教学内容','article','').map(i=>i.id),['custom-note']);
 assert.deepEqual(filterLibrary(items,'市场复盘','case','').map(i=>i.id),['custom-review']);
 for(const topic of ['买点体系','实盘案例','风险管理','趋势基础'])assert.deepEqual(filterLibrary(items,topic,'all',''),[]);
});

test('empty video and course data introduces no preset categories or placeholder content',()=>{
 assert.deepEqual(videoCategories([]),[]);
 assert.deepEqual(buildLibrary([],[],[]),[]);
 assert.deepEqual(filterLibrary(buildLibrary([],[],[]),null,'all',''),[]);
 const notes=buildLibrary([],[post('standalone-note')],[]);
 assert.deepEqual(notes.map(i=>i.type),['article']);
 assert.equal(notes[0].courseId,undefined);
 assert.deepEqual(notes[0].topics,['教学内容']);
 assert.deepEqual(filterLibrary(notes,null,'video',''),[]);
});

test('independent mixed course hierarchy retains links, counts and honest progress placeholders',()=>{
 assert.deepEqual(courseCount(course),{published:3,total:3});
 assert.deepEqual(courseCount({...course,publishedLessons:2,totalLessons:5}),{published:2,total:5});
 assert.deepEqual(courseCount({...course,chapters:[]}),{published:0,total:0});
 assert.deepEqual(courseCount({...course,publishedLessons:0,totalLessons:0}),{published:0,total:0});
 assert.equal(lessonHref(course.chapters[0].lessons[0]),'/video/?id=custom-video');
 assert.equal(lessonHref(course.chapters[0].lessons[1]),'/article/?slug=custom-note');
 assert.equal(lessonHref({contentType:'article',contentId:'自定义/笔记 ?'}),'/article/?slug='+encodeURIComponent('自定义/笔记 ?'));
 assert.deepEqual(emptyProgress(course.id),{courseId:course.id,lessonId:null,progress:null,lastWatchedAt:null,lastPosition:null});
});
