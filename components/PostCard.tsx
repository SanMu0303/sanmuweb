"use client";

import {formatPostTime} from '@/lib/postTime.mjs';
import BoldText from './BoldText';
import PostImages from './PostImages';
import ShortPostBody from './ShortPostBody';
import VideoCard from './VideoCard';
import MemberContentMask from './MemberContentMask';

import type {Post} from '@/lib/posts';
import {timelineHref,filterHref} from '@/lib/posts';
const tones={'观察更新':'observe','交易计划':'plan','交易反馈':'feedback','市场复盘':'review','教学内容':'lesson',video:'lesson'};
export default function PostCard({post,full=false,timeline=false,compact=false,memberGateCompact,signedIn,isAdmin=false,onWatchSaved}:{post:Post;full?:boolean;timeline?:boolean;compact?:boolean;/** Compact only repeated locked cards; the first locked result remains expanded. */memberGateCompact?:boolean;signedIn?:boolean;isAdmin?:boolean;onWatchSaved?:()=>void}) {
  if (post.video) return <article className="research-record" id={'record-'+post.slug}><VideoCard video={post.video} feed/></article>;
  const inline=post.format==='short'||full;
  const short=compact&&post.format==='short'&&!full;
  const showType=post.contentType!=='观察更新';
  const hasSubject=!short&&Boolean(post.symbol||post.timeframe);
  const hasBadges=showType||Boolean(post.isPinned&&!timeline);
  const hasTags=post.tags.length>0;
  const publicTopic=post.publicTitle?.trim()||`${post.symbol||'研究'} · 研究更新`;
  const title=post.locked?publicTopic:(post.statusText||post.title);
  const gateCompact=typeof memberGateCompact==='boolean'?memberGateCompact:compact;
  const authorName=post.author?.name?.trim()||'三木';
  const authorInitial=Array.from(authorName)[0];
  return <article className={'research-record '+(timeline?'timeline-record':'')+(short?' compact-short':compact?' compact-long':'')} id={'record-'+post.slug}>
    {short&&<header className="record-author-header">
      <span className="record-author-avatar" aria-hidden="true">{authorInitial}</span>
      <div className="record-author-meta">
        <strong className="record-author-name">{authorName}</strong>
        <time dateTime={post.updatedAt||post.publishedAt}>{formatPostTime(post.updatedAt,post.publishedAt,false)}</time>
      </div>
    </header>}
    {!short&&(hasSubject||hasBadges)&&<header className="record-heading">
      {hasSubject&&<div className="record-subject">
        {post.symbol&&<a className="symbol-chip" href={timelineHref(post.symbol,post.market)}>{post.symbol}</a>}
        {post.timeframe&&<span className="timeframe">· {post.timeframe}</span>}
      </div>}
      {hasBadges&&<div className="record-badges">
        {showType&&<span className={'record-type type-'+tones[post.contentType]}>{post.contentType}</span>}
        {post.isPinned&&!timeline&&<span className="record-pin">置顶</span>}
      </div>}
    </header>}
    {post.locked&&(compact||post.format==='short')&&<h3 className="record-title member-content-topic">{publicTopic}</h3>}
    {!compact&&post.format!=='short'&&<>
      <h3 className="record-title">{title}</h3>
      {post.statusText&&post.statusText!==post.title&&!post.locked&&<p className="record-deck">{post.title}</p>}
    </>}
    {post.locked?<MemberContentMask publicTitle={post.publicTitle} symbol={post.symbol} signedIn={signedIn} preview={post.preview||post.summary} maskedLines={post.maskedLines} kind="post" compact={gateCompact}/>:short&&!timeline?<ShortPostBody blocks={post.content}/>:inline?<div className="record-body">{post.content.map((b,i)=><section key={i}>
      {b.heading&&(post.format==='short'?<p>{b.heading}</p>:<h4>{b.heading}</h4>)}
      <p>{post.format==='short'?<BoldText text={b.text}/>:b.text}</p>
    </section>)}</div>:<p className="record-summary">
      {compact&&(post.statusText||post.title)!==post.summary&&<><strong className="inline-summary-lead">{post.statusText||post.title}{/[。！？!?]$/.test(post.statusText||post.title)?'':'。'}</strong>{' '}</>}
      {post.summary}
    </p>}
    <PostImages images={post.images}/>
    <footer className="record-footer">
      <div className="record-bottom-meta">
        {!short&&<time dateTime={post.updatedAt||post.publishedAt}>{formatPostTime(post.updatedAt,post.publishedAt,!compact)}</time>}
        <span>{post.market}</span>
        {post.sector&&<a href={filterHref('q',post.sector)}>{post.sector}</a>}
        {short&&post.symbol&&<a className="home-symbol-tag" href={timelineHref(post.symbol,post.market)}>{post.symbol}</a>}
        {short&&post.timeframe&&<span className="home-timeframe">{post.timeframe}</span>}
        {post.trendStage&&<span className={'record-stage record-stage-'+post.trendStage}>{post.trendStage}</span>}
        {short&&showType&&<span className={'record-type type-'+tones[post.contentType]}>{post.contentType}</span>}
        {short&&post.isPinned&&!timeline&&<span className="record-pin">置顶</span>}
        {short&&post.isMemberOnly&&<span className="record-access">会员专属</span>}
        {short&&post.isExample&&<span>教学示例</span>}
      </div>
      {hasTags&&<div className="record-tags">{post.tags.map(tag=><a key={tag} href={filterHref('tag',tag)}>#{tag}</a>)}</div>}
      {!short&&<div className="record-footline">
        <span>{post.author.name} · {post.isMemberOnly?'会员内容':'公开记录'}{post.isExample?' · 教学示例':''}</span>
        {!compact&&!full&&post.format==='long'?<a href={'/article/?slug='+encodeURIComponent(post.slug)}>查看完整内容 <span>↗</span></a>:!compact&&!full&&post.symbol?<a href={timelineHref(post.symbol,post.market)}>查看标的历史 ↗</a>:null}
      </div>}
    </footer>
  </article>;
}
