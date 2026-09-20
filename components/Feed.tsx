"use client";
import {useState,useEffect,useRef} from 'react';
import {Search} from 'lucide-react';
import {useResource} from '@/lib/live';
import QuickComposer from './QuickComposer';
import Archive from './Archive';
import PostCard from './PostCard';
import ResearchFilters from './ResearchFilters';
import ResearchSidebar from './ResearchSidebar';
import PinnedBrief from './PinnedBrief';
import {filterPosts,orderPosts} from '@/server/post-model.mjs';
import {EMPTY_FILTERS,type Post,type PostFilters} from '@/lib/posts';
import type {WatchItem} from '@/lib/types';
const keys={query:'q',contentType:'type',market:'market',stage:'stage',symbol:'symbol',tag:'tag',month:'month'} as const;
export default function Feed({articles,home=false,watchItems=[],onPublished}:{articles:Post[];home?:boolean;watchItems?:WatchItem[];onPublished?:()=>void}){
 const session=useResource<{isAdmin:boolean;signedIn?:boolean}>('/api/session');
 const [filters,setFilters]=useState<PostFilters>(EMPTY_FILTERS);
 type HomeAccess='all'|'public'|'member';
 const [homeAccess,setHomeAccess]=useState<HomeAccess>('all');
 const feedTop=useRef<HTMLDivElement>(null);
 const syncFromUrl=()=>{const params=new URLSearchParams(location.search);const f={...EMPTY_FILTERS};for(const k of Object.keys(keys) as (keyof PostFilters)[])f[k]=params.get(keys[k])||'';setFilters(f);const access=params.get('access');setHomeAccess(access==='public'||access==='member'?access:'all')};
 useEffect(()=>{syncFromUrl();window.addEventListener('popstate',syncFromUrl);return()=>window.removeEventListener('popstate',syncFromUrl)},[]);
 function update(f:PostFilters,scroll=false){setFilters(f);const url=new URL(location.href);for(const k of Object.keys(keys) as (keyof PostFilters)[])if(f[k])url.searchParams.set(keys[k],f[k]);else url.searchParams.delete(keys[k]);history.replaceState({},'',url);if(scroll)feedTop.current?.scrollIntoView({behavior:'smooth',block:'start'})}
 function updateHomeAccess(value:HomeAccess){setHomeAccess(value);const url=new URL(location.href);if(value==='all')url.searchParams.delete('access');else url.searchParams.set('access',value);history.replaceState({},'',url)}
 function month(value:string){const f={...filters,month:value};setFilters(f);const url=new URL(location.href);if(value)url.searchParams.set('month',value);else url.searchParams.delete('month');history.pushState({},'',url);feedTop.current?.scrollIntoView({behavior:'smooth',block:'start'})}
 const active=Object.values(filters).some(Boolean);
 const sorted=orderPosts(articles);
 const shown=filterPosts(sorted,filters);
 const pinned=sorted.filter(p=>p.isPinned);
 const baseStream=home?shown.filter(p=>p.format==='short'&&!p.isPinned):shown;
 const memberOnly=(p:Post)=>p.locked||p.isMemberOnly||p.access==='member'||p.access==='preview'||p.access==='member_required';
 const counts=home?{all:baseStream.length,public:baseStream.filter(p=>!memberOnly(p)).length,member:baseStream.filter(memberOnly).length}:{all:0,public:0,member:0};
 const stream=home?(homeAccess==='public'?baseStream.filter(p=>!memberOnly(p)):homeAccess==='member'?baseStream.filter(memberOnly):baseStream):baseStream;
 const symbols=[...new Set(articles.map(p=>p.symbol).filter(Boolean))].sort();
 let seenLocked=false;
 const renderedStream=stream.map(p=>{const memberGateCompact=seenLocked;if(p.locked)seenLocked=true;return <PostCard key={p.id} post={p} compact={home} memberGateCompact={p.locked?memberGateCompact:undefined} signedIn={session.data?.signedIn} isAdmin={home&&!!session.data?.isAdmin} onWatchSaved={onPublished}/>});
 const emptyHeading=homeAccess==='public'?'暂时没有公开内容':homeAccess==='member'?'暂时没有会员专属内容':'暂无首页短文';
 const emptyDescription=homeAccess==='all'?'趋势观察详情中发布并同步的更新会显示在这里。':'';
 return <>{home&&<QuickComposer onPublished={onPublished}/>} {home&&!active&&homeAccess==='all'&&<PinnedBrief posts={pinned}/>}<div className="research-layout"><section className="stream-column" ref={feedTop} id="research-stream"><div className={home?'stream-toolbar':undefined}><div className="section-line stream-heading"><div className="stream-heading-copy"><h2>{filters.month?filters.month.replace('-',' 年 ')+' 月研究档案':home?'首页短文':'研究档案'}</h2>{home&&<p className="stream-heading-helper">记录最新公开研究判断与趋势阶段</p>}</div><span>{stream.length} 条记录</span></div>{home&&<div className="home-content-tabs" role="tablist" aria-label="首页短文分类">{([['all','全部'],['public','免费内容'],['member','会员专属']] as [HomeAccess,string][]).map(([value,label])=><button key={value} type="button" role="tab" aria-selected={homeAccess===value} className={homeAccess===value?'selected':''} onClick={()=>updateHomeAccess(value)}>{label}<span>{counts[value]}</span></button>)}</div>}{home&&<div className="home-feed-search"><Search size={16} aria-hidden="true"/><input aria-label="搜索首页短文" placeholder="搜索首页短文、标的或关键词…" value={filters.query} onChange={e=>update({...filters,query:e.target.value})}/>{filters.query&&<button type="button" onClick={()=>update({...filters,query:''})}>清除</button>}</div>}</div>{!home&&<ResearchFilters value={filters} onChange={f=>update(f)} symbols={symbols}/>} {!home&&active&&<div className="active-filter-line"><span>{[filters.month,filters.contentType,filters.market,filters.stage,filters.symbol,filters.tag&&'#'+filters.tag,filters.query&&'搜索：'+filters.query].filter(Boolean).join(' · ')}</span><button onClick={()=>update({...EMPTY_FILTERS})}>清除筛选 ×</button></div>}<div aria-live="polite">{renderedStream}{!stream.length&&<div className="empty"><h3>{home?emptyHeading:'没有符合条件的研究记录'}</h3><p>{home?emptyDescription:'试试其他标的或关键词，也可以清除筛选。'}</p>{!home&&<button className="button secondary" onClick={()=>update({...EMPTY_FILTERS})}>查看全部研究</button>}</div>}</div><div className="list-end">已显示 {stream.length} 条 · 让每一次判断都有迹可循</div></section><div className="research-rail">{home&&<ResearchSidebar watchItems={watchItems} posts={sorted}/>} {home?<details className="home-archive"><summary>按历史时间浏览</summary><Archive dates={articles.map(p=>p.publishedAt)} selected={filters.month} onSelect={month}/></details>:<Archive dates={articles.map(p=>p.publishedAt)} selected={filters.month} onSelect={month}/>}</div></div></>}
