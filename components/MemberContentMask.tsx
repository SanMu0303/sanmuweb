"use client";

import {LockKeyhole} from 'lucide-react';

type MemberContentMaskProps = {
  /** Safe text only. The server projection intentionally strips the member body. */
  preview?: string;
  /** Explicit public title; never derive a topic from private body text. */
  publicTitle?: string;
  /** Ticker used only for a neutral fallback topic such as “ETH · 研究更新”. */
  symbol?: string;
  /** Render the topic inside the gate when the parent does not render its own heading. */
  showTopic?: boolean;
  kind?: 'post' | 'watch';
  /** Compact gate used by condensed content streams. */
  compact?: boolean;
  /** Watchlist cards are already links; stop the outer link when the gate opens. */
  nestedLink?: boolean;
  /** Kept for compatibility; local fixed rows are rendered instead of API text. */
  maskedLines?: string[];
  /** Suppress the guest login hint when the caller knows the user is signed in. */
  signedIn?: boolean;
};

// Fixed generic text prevents the protected body's words and paragraph shape
// from leaking through the visual treatment.
const SAFE_ROWS = [
  '研究记录  ·  观测信号  ·  阶段变化',
  '市场背景  ·  结构观察  ·  记录待解锁',
  '趋势脉络  ·  公开摘要  ·  后续更新',
  '研究备注  ·  风险提示  ·  会员可读',
];
const membershipPath = '/membership/subscribe/';

function safeTopic(value: string | undefined, symbol: string | undefined, kind: 'post' | 'watch') {
  const title = (value || '').replace(/\s+/g, ' ').trim();
  const unsafe = /(?:做多|做空|买入|卖出|入场|进场|止盈|止损|仓位|目标价|价格|价位|突破|跌破|挂单|杠杆|合约|long|short|entry|stop\s*loss|take\s*profit|position|leverage|buy|sell)/i;
  if (title && title.length <= 100 && !unsafe.test(title)) return title;
  const ticker = (symbol || '').trim().toUpperCase();
  return /^[A-Z0-9._-]{1,20}$/.test(ticker) ? `${ticker} · 研究更新` : kind === 'watch' ? '趋势观察 · 研究更新' : '研究更新';
}

export default function MemberContentMask({preview, publicTitle, symbol, showTopic = false, kind = 'post', compact = false, nestedLink = false, maskedLines: _maskedLines, signedIn}: MemberContentMaskProps) {
  const topic = safeTopic(publicTitle, symbol, kind);
  const isWatch = kind === 'watch';
  const goMembership = () => window.location.assign(membershipPath);
  const stopAndOpenMembership = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (nestedLink) {
      event.preventDefault();
    }
    goMembership();
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      goMembership();
    }
  };
  // Keep the texture deliberately short. It is only a visual cue and must not
  // make a restricted card resemble a full article or push the feed down.
  const rows = compact ? SAFE_ROWS.slice(0, 2) : SAFE_ROWS.slice(0, 3);
  return <section className={`member-content-mask${compact ? ' is-compact' : ''}`} aria-label={isWatch ? '正在观察 · 会员专属' : '会员专属'} role="link" tabIndex={0} onClick={stopAndOpenMembership} onKeyDown={handleKeyDown}>
    {showTopic && <div className="member-content-mask-topic">
      <strong>{topic}</strong>
    </div>}
    <div className="member-content-mask-body" aria-hidden="true">
      {rows.map((row, index) => <span key={index} style={{width: `${[92, 76, 98, 84][index % 4]}%`}}>{row}</span>)}
    </div>
    <div className="member-content-mask-panel">
      <strong className="member-content-mask-compact-title"><LockKeyhole size={14} strokeWidth={1.8} aria-hidden="true"/>会员专属</strong>
      <span className="member-content-mask-compact-entry">查看权益 ↗</span>
    </div>
  </section>;
}
