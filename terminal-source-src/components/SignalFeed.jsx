import React from "react";
import SignalCard from "./SignalCard.jsx";
export default function SignalFeed({
  signals,
  onSelect,
  selected,
  counts,
  historyCount,
  onClearHistory,
  statusTab,
  onStatus,
  status,
}) {
  return (
    <aside className="signal-feed">
      <div className="panel-heading">
        <h2>信号流</h2>
        <div className="feed-heading-actions">
          <button
            type="button"
            className="clear-signal-history"
            disabled={!historyCount}
            onClick={onClearHistory}
            title="清除所有已推送的历史信号；后续新信号仍会正常显示"
          >
            清除
          </button>
          <span className="eyebrow">SIGNAL QUEUE</span>
        </div>
      </div>
      <div className="status-tabs" aria-label="信号状态">
        {[
          ["unread", "未处理"],
          ["viewed", "已查看"],
          ["watchlist", "观察"],
          ["ignored", "忽略"],
        ].map(([k, v]) => (
          <button
            key={k}
            className={statusTab === k ? "active" : ""}
            aria-pressed={statusTab === k}
            onClick={() => onStatus(k)}
          >
            {v}
            <span>{counts[k] || 0}</span>
          </button>
        ))}
      </div>
      <div className="feed-subhead">
        <span>
          {statusTab === "unread"
            ? "等待你的判断"
            : statusTab === "ignored"
              ? "今日同类信号已静音"
              : "保留你的判断记录"}
        </span>
        <span>最新触发 ↓</span>
      </div>
      <div className="signal-list">
        {signals.map((s) => (
          <SignalCard
            key={s.id}
            signal={s}
            active={selected === s.id}
            onClick={() => onSelect(s)}
          />
        ))}
        {!signals.length && (
          <div className="empty">
            <span className="empty-symbol">
              {statusTab === "unread" ? "✓" : "—"}
            </span>
            {status?.state === "error"
              ? "行情连接失败，等待重试"
              : status?.state === "scanning" || status?.state === "delayed"
                ? "正在建立实时扫描基线"
                : status?.state === "ready" && statusTab === "unread"
                  ? "实时扫描已启动，等待新增事件"
                : statusTab === "unread"
                  ? "当前信号已处理完"
                  : "此分类暂无信号"}
            <small>
              {status?.state === "scanning" || status?.state === "delayed"
                ? "初始化行情只用于建立基线，不会补发历史波动。"
                : status?.state === "ready" && statusTab === "unread"
                  ? "页面保持打开时，币安公开实时流会持续检查符合阈值的新事件。"
                : statusTab === "unread"
                  ? "新信号会自动进入队列。"
                  : "试试切换状态或调整顶部筛选。"}
            </small>
          </div>
        )}
      </div>
      <div className="panel-bottom">
        <span>{signals.length} 条信号</span>
        <span>
          <kbd>J</kbd> 下一条 <kbd>K</kbd> 上一条
        </span>
      </div>
    </aside>
  );
}
