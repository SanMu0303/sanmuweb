"use client";

import {useEffect, useMemo, useState} from 'react';
import PostCard from './PostCard';
import type {Post} from '@/lib/posts';
import styles from './LightHomePreview.module.css';
import {readSiteTheme, writeSiteTheme, type SiteTheme} from './site-theme';
import {useResource} from '@/lib/live';
import {Activity, ArrowUpRight, BookOpen, Compass, LineChart, NotebookPen, UserRound} from 'lucide-react';

type Category = 'all' | 'public' | 'member';
const categoryLabels: Record<Category, string> = {all: '全部', public: '免费内容', member: '会员专属'};
const previewNavigation = [
  ['最新内容', Compass],
  ['趋势观察池', Activity],
  ['交易终端', LineChart],
  ['市场复盘', NotebookPen],
  ['知识库 / 课程', BookOpen],
] as const;

function readCategory(): Category {
  if (typeof window === 'undefined') return 'all';
  const value = new URLSearchParams(window.location.search).get('access');
  return value === 'public' || value === 'member' ? value : 'all';
}

function updateCategory(value: Category) {
  const url = new URL(window.location.href);
  if (value === 'all') url.searchParams.delete('access');
  else url.searchParams.set('access', value);
  window.history.replaceState({}, '', url);
}

export default function LightHomePreview({posts}: {posts: Post[]}) {
  const session = useResource<{signedIn?: boolean; isAdmin?: boolean}>('/api/session');
  const [category, setCategory] = useState<Category>('all');
  const [theme, setTheme] = useState<SiteTheme>('soft');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setCategory(readCategory());
    setTheme(readSiteTheme());
  }, []);
  const counts = useMemo(() => {
    const publicCount = posts.filter(post => !post.isMemberOnly && !post.locked).length;
    const memberCount = posts.length - publicCount;
    return {all: posts.length, public: publicCount, member: memberCount};
  }, [posts]);
  const visible = useMemo(() => posts.filter(post => {
    const member = post.isMemberOnly || post.locked || post.access === 'member' || post.access === 'preview' || post.access === 'member_required';
    if (category === 'public' && member) return false;
    if (category === 'member' && !member) return false;
    const haystack = [post.publicTitle, post.title, post.summary, post.symbol, post.market, ...post.tags].join(' ').toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  }), [category, posts, query]);

  const chooseCategory = (value: Category) => { setCategory(value); updateCategory(value); };
  const chooseTheme = () => {
    const next: SiteTheme = theme === 'soft' ? 'dark' : 'soft';
    setTheme(next);
    writeSiteTheme(next);
  };
  const capturePreviewAction = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('a') || target.closest('.member-content-mask')) {
      event.preventDefault();
      event.stopPropagation();
      setNotice('这是首页亮色版本预览，会员入口与原站数据不会在预览中写入。');
    }
  };

  return <div className={`${styles.root} ${theme === 'dark' ? styles.dark : ''}`} data-theme={theme} onClickCapture={capturePreviewAction}>
    <header className={styles.topbar}>
      <div className={styles.wordmark}><span className={styles.mark}>三</span><span>三木趋势</span><small>RESEARCH JOURNAL</small></div>
      <div className={styles.previewPill}>视觉预览 · 示例数据</div>
      <button className={styles.returnButton} type="button" onClick={() => setNotice('预览未连接正式站，关闭此页面即可返回。')}>返回主站 <span>↗</span></button>
    </header>
    <div className={styles.layout}>
      <aside className={styles.nav} aria-label="预览导航">
        <div className={styles.navTitle}>研究工作台</div>
        <nav>
          {previewNavigation.map(([item, Icon], index) => <button key={item} type="button" className={index === 0 ? styles.activeNav : ''} onClick={() => index === 0 ? undefined : setNotice('本次仅制作首页亮色版本，其他页面暂不包含在预览中。')}><Icon size={16}/><span>{item}</span></button>)}
        </nav>
        <div className={styles.accountLinks} aria-label="账户入口">
          <a href="/membership/" onClick={event => {event.preventDefault();setNotice('本次仅制作首页亮色版本，其他页面暂不包含在预览中。')}}><UserRound size={16}/><span>会员中心</span><ArrowUpRight size={14}/></a>
          {session.data?.signedIn && <a href="/profile/" onClick={event => {event.preventDefault();setNotice('本次仅制作首页亮色版本，其他页面暂不包含在预览中。')}}><span>个人中心</span><ArrowUpRight size={13}/></a>}
          {session.data?.isAdmin && <a href="/admin/" onClick={event => {event.preventDefault();setNotice('本次仅制作首页亮色版本，其他页面暂不包含在预览中。')}}><span>内容管理</span><ArrowUpRight size={13}/></a>}
        </div>
        <div className={styles.navBottom}><span className={styles.statusDot}/>本地设计预览<br/><small>线上版本保持不变</small></div>
      </aside>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div><span className={styles.eyebrow}>SANMU / RESEARCH JOURNAL</span><h1>趋势研究日志</h1><p>观察、记录与复盘，让每一次判断都留下清晰的上下文。</p></div>
          <div className={styles.heroNote}><span>本周研究</span><strong>{posts.length} 条记录</strong><small>持续整理中</small></div>
        </section>
        <div className={styles.composer}>
          <div className={styles.avatar}>三</div><button type="button" onClick={() => setComposerOpen(true)}>记录今天的观察……</button><button type="button" className={styles.writeButton} onClick={() => setComposerOpen(true)}>写一条 <span>↗</span></button>
        </div>
        <div className={styles.contentGrid}>
          <section className={styles.stream} aria-labelledby="short-posts-title">
            <div className={styles.streamHeader}><div><span className={styles.sectionKicker}>PUBLIC NOTES</span><h2 id="short-posts-title">首页短文 <em>{visible.length}</em></h2></div><label className={styles.search}><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索主题、标的或标签" aria-label="搜索短文"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="清除搜索">×</button>}</label></div>
            <div className={styles.tabs} role="tablist" aria-label="内容分类">{(['all', 'public', 'member'] as Category[]).map(value => <button key={value} type="button" role="tab" aria-selected={category === value} className={category === value ? styles.selectedTab : ''} onClick={() => chooseCategory(value)}>{categoryLabels[value]} <span>{counts[value]}</span></button>)}</div>
            <div className={styles.cards}>
              {visible.length ? visible.map((post, index) => {
                const restrictedBefore = visible.slice(0, index).filter(item => item.locked || item.isMemberOnly || item.access === 'member' || item.access === 'preview' || item.access === 'member_required').length;
                return <PostCard key={post.id} post={post} compact memberGateCompact={Boolean(post.locked && restrictedBefore > 0)} signedIn={false}/>;
              }) : <div className={styles.empty}>{category === 'member' ? '暂时没有会员专属内容' : category === 'public' ? '暂时没有公开内容' : '没有匹配的研究记录'}</div>}
            </div>
          </section>
          <aside className={styles.rail}>
            <div className={styles.railBlock}><div className={styles.railHeading}><span>本周重点</span><small>WEEK 39</small></div>{[['BTC','周期结构'],['ETH','波动观察'],['XAU','宏观风险']].map(([symbol,label], i) => <button type="button" className={styles.focus} key={symbol} onClick={() => setQuery(symbol)}><span className={styles.focusSymbol}>{symbol}</span><span>{label}<small>{['运行中','准备中','持续跟踪'][i]}</small></span><b className={i === 1 ? styles.neutral : ''}>{i === 1 ? '—' : '·'}</b></button>)}</div>
            <div className={styles.railBlock}><div className={styles.railHeading}><span>从这里开始</span><small>GUIDE</small></div><p className={styles.guide}><b>01</b> 先从主题与阶段开始<br/><b>02</b> 再回看完整研究记录</p></div>
            <div className={styles.railBlock}><div className={styles.railHeading}><span>研究主题</span><small>TOPICS</small></div><div className={styles.topicList}>{['市场结构','周期观察','风险管理','链上数据'].map(topic => <button type="button" key={topic} onClick={() => setQuery(topic)}>#{topic}</button>)}</div></div>
          </aside>
        </div>
      </main>
    </div>
    {composerOpen && <div className={styles.modalBackdrop} role="presentation" onClick={() => setComposerOpen(false)}><section className={styles.composerModal} role="dialog" aria-modal="true" aria-labelledby="composer-title" onClick={event => event.stopPropagation()}><div className={styles.modalTop}><div><span className={styles.sectionKicker}>LOCAL PREVIEW</span><h2 id="composer-title">写一条</h2></div><button type="button" onClick={() => setComposerOpen(false)} aria-label="关闭">×</button></div><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="记录今天的观察……" autoFocus/><div className={styles.modalFoot}><span>示例草稿 · 不会写入网站</span><button type="button" className={styles.writeButton} onClick={() => {setComposerOpen(false);setNotice('示例草稿已保存在本次预览中，未写入正式网站。')}}>保存草稿</button></div></section></div>}
    <div className={styles.themeDock}><span>页面风格</span><button type="button" aria-pressed={theme === 'dark'} onClick={chooseTheme} title="切换界面风格"><span aria-hidden="true">{theme === 'soft' ? '☾' : '☼'}</span>{theme === 'soft' ? '暗色风格' : '柔和亮面'}</button></div>
    {notice && <button type="button" className={styles.notice} onClick={() => setNotice('')}>{notice}<span>×</span></button>}
  </div>;
}
