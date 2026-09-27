import React from "react";

function formatNumber(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
      })
    : "—";
}

function formatUpdatedAt(value) {
  if (!value) return "—";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 2e10 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
}

function compactSymbol(symbol) {
  const value = String(symbol || "").toUpperCase();
  return value.endsWith("USDT") ? value.slice(0, -4) : value || "—";
}

function rankMovement(item) {
  if (item.isNew) {
    return { label: "NEW", tone: "new", description: "新上榜" };
  }
  const movement = Number(item.rankChange);
  if (Number.isFinite(movement) && movement > 0) {
    return {
      label: `↑${movement}`,
      tone: "up",
      description: `排名上升 ${movement} 位`,
    };
  }
  if (Number.isFinite(movement) && movement < 0) {
    return {
      label: `↓${Math.abs(movement)}`,
      tone: "down",
      description: `排名下降 ${Math.abs(movement)} 位`,
    };
  }
  return {
    label: item.firstSnapshot ? "首次" : "—",
    tone: "steady",
    description: item.firstSnapshot ? "首次计算，尚无上一轮排名" : "排名未变化",
  };
}

function formatQuoteVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (number >= 1e9) return `${(number / 1e9).toFixed(1)}B`;
  if (number >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(0)}K`;
  return formatNumber(number, 0);
}

function rowMetric(item) {
  const volume = formatQuoteVolume(item?.metrics?.quoteVolume24h);
  const change = Number(item?.metrics?.priceChangePercent24h);
  const hasChange = Number.isFinite(change);
  if (!volume && !hasChange) return "数据计算中";
  const price = hasChange
    ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%`
    : "";
  return [volume && `24H ${volume}`, price].filter(Boolean).join(" · ");
}

/**
 * Compact, data-only leaderboard.  The parent owns fetching and snapshotting
 * so this component remains usable for a live endpoint, a local preview, or
 * an explicit test fixture.
 */
export default function ContractHeatPanel({
  items = [],
  state = "loading",
  error = "",
  asOf,
  stale = false,
  source,
  fallback = false,
  universeSize,
  selectedSymbol,
  onSelect,
}) {
  const rows = Array.isArray(items) ? items.slice(0, 20) : [];
  const isDemo = state === "demo";
  const isLoading = state === "loading";
  const hasError = state === "error";
  const statusLabel = isDemo
    ? "LIVE 模式可用"
    : isLoading
      ? "连接中"
      : hasError
        ? "暂不可用"
        : stale
          ? "数据延迟"
          : fallback
            ? "浏览器直连"
            : "已更新";

  return (
    <aside className="contract-heat-panel" aria-labelledby="contract-heat-title">
      <div className="heat-heading">
        <div>
          <span className="eyebrow">BINANCE USDⓈ-M</span>
          <h2 id="contract-heat-title">
            合约热度 <span>TOP 20</span>
          </h2>
        </div>
        <span
          className={`heat-connection ${hasError || stale ? "warning" : ""}`}
          title={
            hasError
              ? error || "合约热度暂不可用"
              : fallback
                ? "同源热度接口暂不可用；当前浏览器直连 Binance USDⓈ-M 公共数据计算"
                : "基于成交活跃度、价格关注度与 OI 活跃度计算"
          }
        >
          <i className="dot" />
          {statusLabel}
        </span>
      </div>
      <div className="heat-description">
        成交 · 价格 · OI 综合排序{fallback ? " · 浏览器直连" : ""} <span>不构成交易建议</span>
      </div>
      <div
        className="heat-list"
        aria-busy={isLoading || state === "refreshing"}
        style={{ "--heat-row-count": Math.max(rows.length, 1) }}
      >
        {rows.map((item) => {
          const movement = rankMovement(item);
          const symbol = compactSymbol(item.symbol);
          const score = Number(item.score);
          const priceChange = Number(item?.metrics?.priceChangePercent24h);
          const selectable = Boolean(item.symbol) && typeof onSelect === "function";
          const isSelected = String(item.symbol || "").toUpperCase() === String(selectedSymbol || "").toUpperCase();
          return (
            <button
              key={`${item.symbol || "unknown"}-${item.rank}`}
              className={`heat-row${isSelected ? " selected" : ""}`}
              type="button"
              disabled={!selectable}
              aria-current={isSelected ? "true" : undefined}
              aria-label={`第 ${item.rank} 名，${symbol}，综合热度 ${
                Number.isFinite(score) ? formatNumber(score, 1) : "暂无"
              }，${movement.description}`}
              onClick={() => selectable && onSelect(item)}
              title={selectable ? `查看 ${symbol} / USDT K 线` : undefined}
            >
              <span className="heat-rank">{String(item.rank).padStart(2, "0")}</span>
              <span className="heat-contract">
                <strong>{symbol}</strong>
                <small className={priceChange < 0 ? "negative" : priceChange > 0 ? "positive" : ""}>
                  {rowMetric(item)}
                </small>
              </span>
              <span className="heat-score" title="综合热度分">
                <strong>{Number.isFinite(score) ? formatNumber(score, 1) : "—"}</strong>
                <small>热度</small>
              </span>
              <span
                className={`heat-movement ${movement.tone}`}
                aria-label={movement.description}
                title={movement.description}
              >
                {movement.label}
              </span>
            </button>
          );
        })}
        {!rows.length && (
          <div className="heat-empty" role={hasError ? "alert" : "status"}>
            <span className="empty-symbol">{hasError ? "!" : isDemo ? "⌁" : "…"}</span>
            {hasError
              ? "热度数据暂不可用"
              : isDemo
                ? "切换 LIVE 查看真实合约热度"
                : "正在汇总币安合约数据"}
            <small>
              {hasError
                ? error || "将自动重试。"
                : isDemo
                  ? "演示模式不生成或伪装实时排行榜。"
                  : "榜单仅使用币安 USDⓈ-M 公共行情。"}
            </small>
          </div>
        )}
      </div>
      <div className="heat-footer">
        <span>{rows.length ? `显示 ${rows.length} / 20` : "Top 20"}</span>
        <span title={source || "binance-usdm"}>
          {asOf ? `更新 ${formatUpdatedAt(asOf)}` : universeSize ? `${universeSize} 个合约` : "等待数据"}
        </span>
      </div>
    </aside>
  );
}
