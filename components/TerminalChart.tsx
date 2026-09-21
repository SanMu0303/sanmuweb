"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./terminal-chart.module.css";

const TRADINGVIEW_SCRIPT =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const DEFAULT_SYMBOL = "BINANCE:BTCUSDT";
const DEFAULT_INTERVAL = "60";
const WIDGET_TIMEOUT_MS = 15_000;

const ALLOWED_INTERVALS = new Set([
  "1",
  "3",
  "5",
  "15",
  "30",
  "45",
  "60",
  "120",
  "180",
  "240",
  "D",
  "W",
  "M",
]);

type ChartStatus = "loading" | "mounted" | "timeout" | "error";

export interface TerminalChartProps {
  /** TradingView symbol, e.g. BINANCE:BTCUSDT. Bare symbols use BINANCE. */
  symbol?: string;
  /** TradingView interval (minutes, D, W or M). */
  interval?: string;
  className?: string;
}

function normalizeSymbol(value?: string) {
  const candidate = value?.trim().toUpperCase() || DEFAULT_SYMBOL;
  // TradingView's widget accepts exchange:symbol. Keeping this deliberately
  // conservative prevents malformed values from being placed in the embed JSON.
  if (!/^[A-Z0-9._-]{1,32}(?::[A-Z0-9._-]{1,48})?$/.test(candidate)) {
    return DEFAULT_SYMBOL;
  }
  return candidate.includes(":") ? candidate : `BINANCE:${candidate}`;
}

function normalizeInterval(value?: string) {
  const candidate = value?.trim().toUpperCase() || DEFAULT_INTERVAL;
  return ALLOWED_INTERVALS.has(candidate) ? candidate : DEFAULT_INTERVAL;
}

/**
 * Embeds TradingView's public Advanced Chart widget. This is intentionally the
 * public widget (with TradingView attribution), rather than the paid Charting
 * Library, so market availability follows TradingView's widget entitlements.
 */
export default function TerminalChart({
  symbol = DEFAULT_SYMBOL,
  interval = DEFAULT_INTERVAL,
  className,
}: TerminalChartProps) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [status, setStatus] = useState<ChartStatus>("loading");
  const widgetId = useId().replace(/:/g, "");
  const tvSymbol = normalizeSymbol(symbol);
  const tvInterval = normalizeInterval(interval);

  useEffect(() => {
    const host = widgetRef.current;
    if (!host) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let pollId: number | undefined;
    setStatus("loading");
    host.replaceChildren();

    const widget = document.createElement("div");
    widget.className = styles.widget;

    const attribution = document.createElement("div");
    attribution.className = styles.attribution;
    const attributionLink = document.createElement("a");
    attributionLink.href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
    attributionLink.target = "_blank";
    attributionLink.rel = "noopener noreferrer nofollow";
    attributionLink.textContent = `${tvSymbol} 图表`;
    attribution.append(attributionLink, document.createTextNode(" · TradingView"));

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = TRADINGVIEW_SCRIPT;
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: "Asia/Shanghai",
      theme: "dark",
      backgroundColor: "#101214",
      gridColor: "rgba(119, 136, 122, 0.14)",
      style: "1",
      locale: "zh_CN",
      allow_symbol_change: true,
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      save_image: false,
      withdateranges: true,
      calendar: false,
      details: false,
      hotlist: false,
      support_host: "https://www.tradingview.com",
    });

    const clearTimers = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (pollId !== undefined) window.clearInterval(pollId);
    };

    const fail = (nextStatus: "error" | "timeout") => {
      if (cancelled) return;
      clearTimers();
      setStatus(nextStatus);
    };

    script.addEventListener("load", () => {
      if (cancelled) return;
      // The embed script being loaded does not guarantee that market data has
      // arrived; the live widget remains responsible for its own data state.
      setStatus("mounted");
      // The public script may append its iframe asynchronously. Keep the
      // timeout alive until an embed is present so a blocked widget still has
      // an actionable fallback, without claiming that the iframe means data
      // has loaded.
      pollId = window.setInterval(() => {
        if (cancelled) return;
        if (widget.querySelector("iframe")) clearTimers();
      }, 250);
    });
    script.addEventListener("error", () => fail("error"));

    widget.append(script);
    host.append(widget, attribution);
    timeoutId = window.setTimeout(() => fail("timeout"), WIDGET_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimers();
      host.replaceChildren();
    };
  }, [tvInterval, tvSymbol, retryToken]);

  const chartClassName = [styles.chart, className].filter(Boolean).join(" ");
  const statusText =
    status === "loading"
      ? "正在加载 TradingView 图表…"
      : status === "timeout"
        ? "图表加载超时，请重试或在 TradingView 中打开。"
        : status === "error"
          ? "TradingView 图表暂时无法加载，请重试。"
          : "TradingView 图表组件已加载，行情数据由 TradingView 提供。";

  return (
    <section
      className={chartClassName}
      aria-label={`${tvSymbol} K线图`}
      aria-busy={status === "loading"}
      data-chart-status={status}
      data-chart-id={widgetId}
    >
      <div ref={widgetRef} className={styles.embed} />
      <p className={styles.status} aria-live="polite">
        {statusText}
      </p>
      {status === "loading" && (
        <div className={styles.loading} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>正在连接 TradingView…</span>
        </div>
      )}
      {(status === "timeout" || status === "error") && (
        <div className={styles.fallback} role="alert">
          <p>{statusText}</p>
          <div className={styles.fallbackActions}>
            <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
              重试
            </button>
            <a
              href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              在 TradingView 打开 ↗
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
