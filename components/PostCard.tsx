"use client";

import {formatPostTime} from '@/lib/postTime.mjs';
import BoldText from './BoldText';
import PostImages from './PostImages';
import ShortPostBody from './ShortPostBody';
import VideoCard from './VideoCard';

import type {Post} from '@/lib/posts';
import {timelineHref,filterHref} from '@/lib/posts';
const tones={'观察更新':'observe','交易计划':'plan','交易反馈':'feedback','市场复盘':'review','教学内容':'lesson',video:'lesson'};
export default function PostCard({post,full=false,timeline=false,compact=false,isAdmin=false,onWatchSaved}:{post:Post;full?:boolean;timeline?:boolean;compact?:boolean;isAdmin?:boolean;onWatchSaved?:()=>void}) {
  if (post.video) return <article className="research-record" id={'record-'+post.slug}><VideoCard video={post.video} feed/></article>;
  const inline=post.format==='short'||full;
  const short=compact&&post.format==='short'&&!full;
  const showType=post.contentType!=='观察更新';
  const hasSubject=!short&&Boolean(post.symbol||post.timeframe);
  const hasBadges=showType||Boolean(post.isPinned&&!timeline);
  const hasTags=post.tags.length>0;
  return <article className={'research-record '+(timeline?'timeline-record':'')+(short?' compact-short':compact?' compact-long':'')} id={'record-'+post.slug}>
    {(hasSubject||hasBadges)&&<header className="record-heading">
      {hasSubject&&<div className="record-subject">
        {post.symbol&&<a className="symbol-chip" href={timelineHref(post.symbol,post.market)}>{post.symbol}</a>}
        {post.timeframe&&<span className="timeframe">· {post.timeframe}</span>}
      </div>}
      {hasBadges&&<div className="record-badges">
        {showType&&<span className={'record-type type-'+tones[post.contentType]}>{post.contentType}</span>}
        {post.isPinned&&!timeline&&<span className="record-pin">置顶</span>}
      </div>}
    </header>}
    {!compact&&post.format!=='short'&&<>
      <h3 className="record-title">{post.statusText||post.title}</h3>
      {post.statusText&&post.statusText!==post.title&&<p className="record-deck">{post.title}</p>}
    </>}
    {short&&!timeline?<ShortPostBody blocks={post.content}/>:inline?<div className="record-body">{post.content.map((b,i)=><section key={i}>
      {b.heading&&(post.format==='short'?<p>{b.heading}</p>:<h4>{b.heading}</h4>)}
      <p>{post.format==='short'?<BoldText text={b.text}/>:b.text}</p>
    </section>)}</div>:<p className="record-summary">
      {compact&&(post.statusText||post.title)!==post.summary&&<><strong className="inline-summary-lead">{post.statusText||post.title}{/[。！？!?]$/.test(post.statusText||post.title)?'':'。'}</strong>{' '}</>}
      {post.summary}
    </p>}
    {!inline&&post.locked&&post.content[0]&&(!compact||post.content[0].text!==post.summary)&&<div className="record-preview"><p>{post.content[0].text}</p></div>}
    <PostImages images={post.images}/>
    {post.locked&&compact?<div className="compact-member-note"><span>{post.access==='preview'?'公开摘要 · 全文需会员':'会员内容 · 公开预览'}</span><a href="/membership/">开通会员 ↗</a></div>:post.locked&&<div className="member-preview-note"><span>{post.access==='preview'?'公开摘要 · 全文需会员':'会员研究 · 公开预览'}</span><p>订阅会员后查看完整执行内容和持续更新。</p><a href="/membership/">查看会员权益 ↗</a></div>}
    <footer className="record-footer">
      <div className="record-bottom-meta">
        <time dateTime={post.updatedAt||post.publishedAt}>{formatPostTime(post.updatedAt,post.publishedAt,!compact)}</time>
        <span>{post.market}</span>
        {post.sector&&<a href={filterHref('q',post.sector)}>{post.sector}</a>}
        {short&&post.symbol&&<a className="home-symbol-tag" href={timelineHref(post.symbol,post.market)}>{post.symbol}</a>}
        {short&&post.timeframe&&<span className="home-timeframe">{post.timeframe}</span>}
        {post.trendStage&&<span className={'record-stage record-stage-'+post.trendStage}>{post.trendStage}</span>}
      </div>
      {hasTags&&<div className="record-tags">{post.tags.map(tag=><a key={tag} href={filterHref('tag',tag)}>#{tag}</a>)}</div>}
      <div className="record-footline">
        <span>{post.author.name} · {post.isMemberOnly?'会员内容':'公开记录'}{post.isExample?' · 教学示例':''}</span>
        {!compact&&!full&&post.format==='long'?<a href={'/article/?slug='+encodeURIComponent(post.slug)}>查看完整内容 <span>↗</span></a>:!compact&&!full&&post.symbol?<a href={timelineHref(post.symbol,post.market)}>查看标的历史 ↗</a>:null}
      </div>
    </footer>
  </article>;
}
