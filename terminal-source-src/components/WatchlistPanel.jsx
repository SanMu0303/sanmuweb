import React, { useState } from "react";
export const STAGES = {
  preparation: "准备",
  launch: "启动",
  trend: "运行",
  climax: "高潮",
  reversal: "反转",
};
export default function WatchlistPanel({
  items,
  onChange,
  onSelect,
  plans,
  onOpenPlans,
  onClose,
}) {
  const [expanded, setExpanded] = useState(null);
  return (
    <aside className="watchlist-panel">
      <div className="panel-heading">
        <h2>
          观察池 <span>{items.length}</span>
        </h2>
        <span className="eyebrow">WAITING FOR</span>
        <button
          className="watch-close"
          aria-label="收起观察池"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="watch-intro">下一步，在等什么。</div>
      <div className="watch-list">
        {items.map((item) => {
          const key = item.symbol + item.timeframe,
            edit = (patch) =>
              onChange(items.map((x) => (x === item ? { ...x, ...patch } : x)));
          return (
            <article key={key} className="watch-card">
              <div className="watch-top">
                <button className="watch-symbol" onClick={() => onSelect(item)}>
                  <strong>{item.symbol.replace("USDT", "")}</strong>
                  <span>
                    {item.timeframe} <i>↗</i>
                  </span>
                </button>
                <button
                  className="icon-button"
                  aria-label={"删除 " + item.symbol}
                  onClick={() => onChange(items.filter((x) => x !== item))}
                >
                  ×
                </button>
              </div>
              <div className="stage-row">
                <label>阶段</label>
                <select
                  aria-label={item.symbol + " 阶段"}
                  value={item.stage}
                  onChange={(e) => edit({ stage: e.target.value })}
                >
                  {Object.entries(STAGES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <label className="waiting">
                等待
                <input
                  aria-label={item.symbol + " 等待条件"}
                  value={item.waitingFor}
                  maxLength={120}
                  placeholder="设置下一次确认条件"
                  onChange={(e) => edit({ waitingFor: e.target.value })}
                />
              </label>
              <button
                className="note-toggle"
                onClick={() => setExpanded(expanded === key ? null : key)}
              >
                {item.note ? "≡ " + item.note : "＋ 添加简短备注"}
              </button>
              {expanded === key && (
                <textarea
                  aria-label={item.symbol + " 备注"}
                  value={item.note}
                  maxLength={300}
                  onChange={(e) => edit({ note: e.target.value })}
                />
              )}
              <div className="watch-observing">
                <i className="dot" />
                观察中
              </div>
              <small className="watch-date">
                {new Date(item.addedAt).toLocaleDateString("zh-CN")} 加入 ·
                Crypto
              </small>
            </article>
          );
        })}
        {!items.length && (
          <div className="empty">
            观察池还没有标的<small>看图后，点击「加入观察池」。</small>
          </div>
        )}
      </div>
      <div className="watch-bottom">
        <button onClick={onOpenPlans}>
          交易计划 <span>{plans.length} →</span>
        </button>
        <small>保存在此浏览器 · {items.length} 个观察标的</small>
      </div>
    </aside>
  );
}
