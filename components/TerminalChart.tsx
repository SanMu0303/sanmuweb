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

export type TerminalChartStatus = "loading" | "ready" | "error";
type ChartStatus = TerminalChartStatus | "timeout";

export interface TerminalChartProps {
  /** TradingView symbol, e.g. BINANCE:BTCUSDT. Bare symbols use BINANCE. */
  symbol?: string;
  /** TradingView interval (minutes, D, W or M). */
  interval?: string;
  className?: string;
  /** "ready" means the embedded frame loaded, not that its market feed is live. */
  onStatusChange?: (status: TerminalChartStatus) => void;
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
 * public widget with its attribution. Symbol search, intervals, indicators and
 * drawing tools stay inside TradingView; this embed has no public feed API.
 */
export default function TerminalChart({
  symbol = DEFAULT_SYMBOL,
  interval = DEFAULT_INTERVAL,
  className,
  onStatusChange,
}: TerminalChartProps) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const statusCallbackRef = useRef(onStatusChange);
  const [retryToken, setRetryToken] = useState(0);
  const [status, setStatus] = useState<ChartStatus>("loading");
  const widgetId = useId().replace(/:/g, "");
  const tvSymbol = normalizeSymbol(symbol);
  const tvInterval = normalizeInterval(interval);

  useEffect(() => {
    statusCallbackRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    statusCallbackRef.current?.(status === "timeout" ? "error" : status);
  }, [status]);

  useEffect(() => {
    const host = widgetRef.current;
    if (!host) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let frame: HTMLIFrameElement | null = null;
    setStatus("loading");
    host.replaceChildren();

    const widget = document.createElement("div");
    widget.className = `tradingview-widget-container__widget ${styles.widget}`;

    const attribution = document.createElement("div");
    attribution.className = `tradingview-widget-copyright ${styles.attribution}`;
    const attributionLink = document.createElement("a");
    attributionLink.href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&utm_source=sanmuqushi.com&utm_medium=widget_new&utm_campaign=advanced-chart`;
    attributionLink.target = "_blank";
    attributionLink.rel = "noopener noreferrer nofollow";
    attributionLink.textContent = "市场图表";
    attribution.append(attributionLink, document.createTextNode(" by TradingView"));

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
      backgroundColor: "#101419",
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

    const clearTimer = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };

    const fail = (nextStatus: "error" | "timeout") => {
      if (cancelled) return;
      clearTimer();
      setStatus(nextStatus);
    };

    const onFrameLoad = () => {
      if (cancelled) return;
      // Cross-origin iframe load is observable; market connectivity is not.
      // TradingView itself displays unavailable symbols and feed errors.
      clearTimer();
      setStatus("ready");
    };
    const observeFrame = () => {
      const nextFrame = host.querySelector("iframe");
      if (!nextFrame || nextFrame === frame) return;
      frame?.removeEventListener("load", onFrameLoad);
      frame = nextFrame;
      if (!frame.title) frame.title = "TradingView 市场图表";
      frame.addEventListener("load", onFrameLoad);
    };
    const observer = new MutationObserver(observeFrame);
    observer.observe(host, { childList: true, subtree: true });
    const onScriptError = () => fail("error");
    script.addEventListener("error", onScriptError);

    // Keep TradingView's official sibling structure: widget, copyright, script.
    // The copyright has its own 32px row instead of covering the chart toolbar.
    host.append(widget, attribution, script);
    timeoutId = window.setTimeout(() => fail("timeout"), WIDGET_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimer();
      observer.disconnect();
      frame?.removeEventListener("load", onFrameLoad);
      script.removeEventListener("error", onScriptError);
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
          : "TradingView 图表窗口已加载，行情连接和数据可用性以图表内状态为准。";

  return (
    <section
      className={chartClassName}
      aria-label={`${tvSymbol} K线图`}
      aria-busy={status === "loading"}
      data-chart-status={status}
      data-chart-id={widgetId}
    >
      <div ref={widgetRef} className={`tradingview-widget-container ${styles.embed}`} />
      <p className={styles.status} aria-live="polite">
        {statusText}
      </p>
      {status === "loading" && (
        <div className={styles.loading} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>正在加载 TradingView…</span>
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
