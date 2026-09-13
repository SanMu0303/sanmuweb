import {formatPostTime} from '@/lib/postTime.mjs';
import type {Post} from '@/lib/posts';

export default function PinnedBrief({posts}:{posts:Post[]}) {
 if(!posts.length)return null;
 return <section className="pinned-brief" aria-label="置顶研究">{posts.map(post=>{
  const title=post.statusText||post.title||post.content[0]?.text.split('\n')[0]||'置顶研究';
  const summary=(post.summary||post.content[0]?.text||'').replaceAll('**','');
  return <a key={post.id} className="pinned-entry" href={'/article/?slug='+encodeURIComponent(post.slug)}>
   <div className="pinned-copy"><div className="pinned-title-line"><span className="pinned-label">置顶</span><h2>{title}</h2></div><p>{summary}</p></div>
   <div className="pinned-action"><time dateTime={post.updatedAt||post.publishedAt}>{formatPostTime(post.updatedAt,post.publishedAt)}</time><span>查看详情 ↗</span></div>
  </a>;
 })}</section>;
}
