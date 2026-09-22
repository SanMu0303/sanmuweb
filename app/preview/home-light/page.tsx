import {notFound} from 'next/navigation';
import type {Post} from '@/lib/posts';
import LightHomePreview from '@/components/LightHomePreview';

export const metadata = {
  title: '首页亮色版本 · 本地预览',
  description: '三木趋势研究日志首页的亮色设计预览。',
};

function samplePost(overrides: Partial<Post>): Post {
  return {
    id: 'preview-post', slug: 'preview-post', title: '研究日志', publicTitle: '市场结构观察',
    summary: '围绕市场结构与阶段变化的公开记录。', preview: '安全公开摘要：记录当前观察主题与阶段。',
    content: [{heading: '', text: '这是一条用于视觉预览的公开研究记录，展示信息流的阅读节奏与层级。\n\n内容在这里保持克制、清晰，并保留自然的段落间距。'}],
    contentType: '市场复盘', format: 'short', symbol: 'BTC', market: '加密', sector: '数字资产',
    trendStage: '运行', status: 'published', statusText: '结构仍在观察', timeframe: '1D',
    tags: ['市场结构', '研究日志'], images: [], isPinned: false, isMemberOnly: false, isPublic: true,
    publishedAt: '2026-09-22T09:18:00.000Z', updatedAt: '2026-09-22T09:32:00.000Z',
    author: {id: 'sanmu', name: '三木'}, readTime: 2, tradeId: null, watchlistId: null,
    relatedPosts: [], isExample: false, locked: false, revision: 1,
    ...overrides,
  };
}

// Deliberately safe, non-production sample content. Member cards contain no
// private body, image, attachment, or executable trading condition.
const previewPosts: Post[] = [
  samplePost({id: 'preview-1', slug: 'preview-1', publicTitle: 'BTC · 周期结构观察', title: '周期结构观察', summary: '公开记录市场所处阶段与后续观察方向。', statusText: '运行中的结构', tags: ['BTC', '周期'], images: [{id: 'btc-chart', url: '/charts/btc-range.svg', alt: 'BTC 区间结构示意图', isPreview: true, width: 640, height: 245}]}),
  samplePost({id: 'preview-2', slug: 'preview-2', publicTitle: 'ETH · 研究更新', title: 'ETH 研究更新', summary: '公开摘要：观察波动、成交与结构变化。', symbol: 'ETH', statusText: '等待确认', trendStage: '准备', tags: ['ETH', '波动'] }),
  samplePost({id: 'preview-member-1', slug: 'preview-member-1', publicTitle: 'SOL · 研究更新', title: '受限研究正文', summary: '公开主题：SOL · 研究更新。', symbol: 'SOL', access: 'member', isMemberOnly: true, isPublic: false, locked: true, content: [], images: [], trendStage: '启动', statusText: '会员专属记录', tags: ['SOL', '会员专属'] }),
  samplePost({id: 'preview-3', slug: 'preview-3', publicTitle: '黄金 · 风险观察', title: '风险观察', summary: '公开记录：宏观变量与风险偏好的变化。', symbol: 'XAU', market: '黄金', sector: '宏观', trendStage: '准备', tags: ['宏观', '风险'] }),
  samplePost({id: 'preview-member-2', slug: 'preview-member-2', publicTitle: 'BTC · 会员研究更新', title: '受限研究正文', summary: '公开主题：BTC · 会员研究更新。', symbol: 'BTC', access: 'member', isMemberOnly: true, isPublic: false, locked: true, content: [], images: [], trendStage: '运行', statusText: '会员专属记录', tags: ['BTC', '会员专属'] }),
];

export default function LightHomePage() {
  // The route is intentionally unavailable in production. The local command
  // below enables it explicitly: DESIGN_PREVIEW_BUILD=1 npm run build
  if (process.env.DESIGN_PREVIEW_BUILD !== '1') notFound();
  return <LightHomePreview posts={previewPosts} />;
}
