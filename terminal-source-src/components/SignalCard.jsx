import React, { useRef, useEffect } from "react";
import { signalPriority, signalTone } from "../signalPresentation.mjs";
export default function SignalCard({ signal: s, active, onClick }) {
  const ref = useRef();
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const status = s.status || "unread",
    count = s.triggerCount || 1;
  return (
    <button
      ref={ref}
      className={`signal-card priority-${signalPriority(s)} tone-${signalTone(s)} status-${status} ${active ? "selected" : ""}`}
      onClick={onClick}
      data-testid={"signal-" + s.symbol}
      aria-pressed={active}
    >
      <div className="signal-top">
        <strong>{s.symbol.replace("USDT", "")}</strong>
        <span className="signal-tf">{s.timeframe}</span>
        <time
          title={new Date(s.detectedAt || s.triggeredAt * 1000).toLocaleString(
            "zh-CN",
          )}
        >
          {new Date(s.detectedAt || s.triggeredAt * 1000).toLocaleTimeString(
            "zh-CN",
            {
              hour: "2-digit",
              minute: "2-digit",
            },
          )}
        </time>
      </div>
      <div className="signal-title">
        <i className="signal-indicator" />
        {s.title}
      </div>
      <div className="signal-value">{s.value}</div>
      <div className="signal-meta">
        <span>
          {count > 1
            ? `触发 ${count} 次 · 最新 ${new Date(s.detectedAt || s.triggeredAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
            : signalPriority(s) === "high"
              ? "重点观察"
              : s.metadata?.partial
                ? "强平快照 · 非完整逐笔总量"
                : s.metadata?.confirmation === "realtime"
                  ? "实时流触发"
                  : s.metadata?.confirmation === "intrabar"
                ? "盘中触发 · 未收盘"
                : s.type === "oi"
                  ? "OI 采样触发"
                  : "已收盘确认"}
        </span>
        <span className={"state " + status}>
          {status === "watchlist"
            ? "● 观察中"
            : status === "viewed"
              ? "已查看"
              : status === "ignored"
                ? "已忽略"
                : "待处理"}
        </span>
      </div>
    </button>
  );
}
