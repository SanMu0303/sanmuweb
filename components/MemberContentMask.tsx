"use client";

import Link from 'next/link';

type MemberContentMaskProps = {
  /** Safe text only. The server projection intentionally strips the member body. */
  preview?: string;
  kind?: 'post' | 'watch';
  compact?: boolean;
  /** Watchlist cards are already links; use a button so we do not nest an anchor. */
  nestedLink?: boolean;
  maskedLines?: string[];
};

/**
 * A deliberately content-free member gate. The text rows are generated from
 * neutral placeholder glyphs, so the visual shape never doubles as a copy of
 * the protected article. The server must still project the safe preview; this
 * component is only presentation and never receives a private body.
 */
export default function MemberContentMask({preview, kind = 'post', compact = false, nestedLink = false, maskedLines}: MemberContentMaskProps) {
  const safePreview = (preview || '').trim();
  const widths = compact ? [82, 96, 66] : [96, 84, 71, 91, 62];
  const rows = maskedLines?.length ? maskedLines : widths.map(() => '内容占位 · · · · · ·');
  const cta = nestedLink ? (
    <button
      type="button"
      className="button secondary member-content-mask-cta"
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign('/membership/subscribe/');
      }}
    >开通会员 ↗</button>
  ) : <Link className="button secondary member-content-mask-cta" href="/membership/subscribe/" onClick={event => event.stopPropagation()}>开通会员 ↗</Link>;

  const openMembership = () => {
    if (!nestedLink) window.location.assign('/membership/subscribe/');
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!nestedLink && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openMembership();
    }
  };

  return <section
    className={`member-content-mask${compact ? ' is-compact' : ''}`}
    aria-label="会员内容"
    role={!nestedLink ? 'link' : undefined}
    tabIndex={!nestedLink ? 0 : undefined}
    onClick={openMembership}
    onKeyDown={handleKeyDown}
  >
    {safePreview && <p className="member-content-safe-preview">{safePreview}</p>}
    <div className="member-content-mask-body" aria-hidden="true">
      {rows.map((row, index) => <span key={index} style={{width: `${widths[index % widths.length]}%`}}>{row}</span>)}
    </div>
    <div className="member-content-mask-panel">
      <span className="member-content-mask-label">{kind === 'watch' ? '正在观察 · 会员内容' : '会员内容'}</span>
      <strong>{kind === 'watch' ? '开通会员，查看完整观察记录' : '开通会员，查看完整内容'}</strong>
      <small>当前内容包含持续更新和完整判断</small>
      {cta}
    </div>
  </section>;
}
