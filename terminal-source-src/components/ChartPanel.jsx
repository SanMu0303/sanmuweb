import ContractPicker from "./ContractPicker.jsx";
import MarketSummary from "./MarketSummary.jsx";
import React, { useDeferredValue, useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
} from "lightweight-charts";
import { mergeKlines } from "../providers/realtime.mjs";
import { chartWindow, triggerRange } from "../chartWindow.mjs";
import {
  signalColor,
  signalTone,
  SIGNAL_COLORS,
} from "../signalPresentation.mjs";
import { TIMEFRAMES, SECONDS } from "../scanner/config.mjs";
import {
  bollingerBands,
  candleChangePercent,
  chartDrawing,
  exponentialMovingAverage,
  relativeStrengthIndex,
  simpleMovingAverage,
  volumeWeightedAveragePrice,
} from "../chartTools.mjs";
import {
  chartIndicatorLabel,
  createChartIndicator,
  decodeChartIndicators,
  encodeChartIndicators,
  INDICATOR_TYPES,
  MAX_CHART_INDICATORS,
  normalizeChartIndicators,
} from "../chartIndicators.mjs";
import { storage } from "../storage.mjs";
const MAIN_LINE_OPTIONS = {
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
};

function lineOptions(color, title, extra = {}) {
  return { ...MAIN_LINE_OPTIONS, color, title, ...extra };
}

function makeIndicatorDescriptors(indicators, bars) {
  return indicators
    .filter((indicator) => indicator.enabled)
    .flatMap((indicator) => {
      const title = chartIndicatorLabel(indicator);
      const color = indicator.color;
      switch (indicator.type) {
        case "sma":
          return [
            {
              id: indicator.id,
              type: indicator.type,
              pane: 0,
              lines: [
                {
                  key: "value",
                  data: simpleMovingAverage(bars, indicator.period),
                  options: lineOptions(color, title),
                },
              ],
            },
          ];
        case "ema":
          return [
            {
              id: indicator.id,
              type: indicator.type,
              pane: 0,
              lines: [
                {
                  key: "value",
                  data: exponentialMovingAverage(bars, indicator.period),
                  options: lineOptions(color, title, { lineStyle: 2 }),
                },
              ],
            },
          ];
        case "bollinger": {
          const bands = bollingerBands(
            bars,
            indicator.period,
            indicator.multiplier,
          );
          return [
            {
              id: indicator.id,
              type: indicator.type,
              pane: 0,
              lines: [
                {
                  key: "upper",
                  data: bands.upper,
                  options: lineOptions(color, `${title} 上轨`, { lineStyle: 2 }),
                },
                {
                  key: "middle",
                  data: bands.middle,
                  options: lineOptions(color, `${title} 中轨`),
                },
                {
                  key: "lower",
                  data: bands.lower,
                  options: lineOptions(color, `${title} 下轨`, { lineStyle: 2 }),
                },
              ],
            },
          ];
        }
        case "rsi":
          return [
            {
              id: indicator.id,
              type: indicator.type,
              pane: 2,
              levels: {
                overbought: indicator.overbought,
                oversold: indicator.oversold,
              },
              lines: [
                {
                  key: "value",
                  data: relativeStrengthIndex(bars, indicator.period),
                  options: lineOptions(color, title, {
                    lineWidth: 2,
                    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
                    autoscaleInfoProvider: () => ({
                      priceRange: { minValue: 0, maxValue: 100 },
                      margins: { above: 0.08, below: 0.08 },
                    }),
                  }),
                },
              ],
            },
          ];
        case "vwap":
          return [
            {
              id: indicator.id,
              type: indicator.type,
              pane: 0,
              lines: [
                {
                  key: "value",
                  data: volumeWeightedAveragePrice(bars),
                  options: lineOptions(color, title, { lineWidth: 2 }),
                },
              ],
            },
          ];
        default:
          return [];
      }
    });
}

function IndicatorSettings({ indicators, onAdd, onChange, onRemove, onReset }) {
  return (
    <section className="chart-indicator-settings" aria-label="图表指标设置">
      <header>
        <div>
          <strong>指标设置</strong>
          <span>可同时叠加多根均线；周期范围 2–500</span>
        </div>
        <button type="button" className="indicator-reset" onClick={onReset}>
          恢复默认
        </button>
      </header>
      <div className="indicator-add-row" aria-label="添加指标">
        {Object.entries(INDICATOR_TYPES).map(([type, definition]) => (
          <button
            key={type}
            type="button"
            disabled={indicators.length >= MAX_CHART_INDICATORS && type !== "vwap"}
            onClick={() => onAdd(type)}
          >
            ＋ {definition.label}
          </button>
        ))}
        <span className="indicator-limit">最多 {MAX_CHART_INDICATORS} 项</span>
      </div>
      <div className="indicator-editor-list">
        {!indicators.length && (
          <p className="indicator-empty">尚未添加指标，可从上方选择。</p>
        )}
        {indicators.map((indicator) => {
          const definition = INDICATOR_TYPES[indicator.type];
          const supportsPeriod = Boolean(definition.defaultPeriod);
          return (
            <div
              className={`indicator-editor-row${indicator.enabled ? " is-enabled" : ""}`}
              key={indicator.id}
            >
              <label className="indicator-enabled" title="显示或隐藏指标">
                <input
                  type="checkbox"
                  checked={indicator.enabled}
                  onChange={(event) =>
                    onChange(indicator.id, { enabled: event.target.checked })
                  }
                />
                <span className="sr-only">{chartIndicatorLabel(indicator)}</span>
              </label>
              <select
                aria-label={`${chartIndicatorLabel(indicator)} 指标类型`}
                value={indicator.type}
                onChange={(event) =>
                  onChange(indicator.id, { type: event.target.value })
                }
              >
                {Object.entries(INDICATOR_TYPES).map(([type, item]) => (
                  <option value={type} key={type}>
                    {item.label}
                  </option>
                ))}
              </select>
              {supportsPeriod && (
                <label>
                  <span>周期</span>
                  <input
                    key={`${indicator.id}:period:${indicator.period}`}
                    aria-label={`${definition.label} 周期`}
                    type="number"
                    inputMode="numeric"
                    min="2"
                    max="500"
                    defaultValue={indicator.period}
                    onBlur={(event) =>
                      onChange(indicator.id, { period: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
              )}
              {indicator.type === "bollinger" && (
                <label>
                  <span>倍数</span>
                  <input
                    key={`${indicator.id}:multiplier:${indicator.multiplier}`}
                    aria-label="布林带倍数"
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    max="10"
                    step="0.1"
                    defaultValue={indicator.multiplier}
                    onBlur={(event) =>
                      onChange(indicator.id, {
                        multiplier: event.target.value,
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
              )}
              {indicator.type === "rsi" && (
                <div className="indicator-rsi-levels">
                  <label>
                    <span>超买</span>
                    <input
                      key={`${indicator.id}:overbought:${indicator.overbought}`}
                      aria-label="RSI 超买"
                      type="number"
                      inputMode="decimal"
                      min="50"
                      max="100"
                      step="1"
                      defaultValue={indicator.overbought}
                      onBlur={(event) =>
                        onChange(indicator.id, { overbought: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                  <label>
                    <span>超卖</span>
                    <input
                      key={`${indicator.id}:oversold:${indicator.oversold}`}
                      aria-label="RSI 超卖"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="50"
                      step="1"
                      defaultValue={indicator.oversold}
                      onBlur={(event) =>
                        onChange(indicator.id, { oversold: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                </div>
              )}
              <label className="indicator-color" title="指标线颜色">
                <span className="sr-only">{chartIndicatorLabel(indicator)} 颜色</span>
                <input
                  aria-label={`${chartIndicatorLabel(indicator)} 颜色`}
                  type="color"
                  value={indicator.color}
                  onChange={(event) =>
                    onChange(indicator.id, { color: event.target.value })
                  }
                />
              </label>
              <span className="indicator-row-label">
                {chartIndicatorLabel(indicator)}
              </span>
              <button
                type="button"
                className="indicator-remove"
                aria-label={`删除 ${chartIndicatorLabel(indicator)}`}
                title="删除指标"
                onClick={() => onRemove(indicator.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function applyAuxiliaryPaneHeights(api, surface, oiVisible, hasRsi) {
  const height = Math.max(surface?.clientHeight || 0, 220);
  const oiHeight = oiVisible
    ? Math.min(130, Math.max(72, Math.round(height * 0.27)))
    : 30;
  const rsiHeight = hasRsi
    ? Math.min(104, Math.max(68, Math.round(height * 0.22)))
    : 30;
  api.chart.panes()[1]?.setHeight(oiHeight);
  api.chart.panes()[2]?.setHeight(rsiHeight);
}

export function CandleChart({
  bars,
  identity,
  marker,
  volume,
  oiPoints,
  oiVisible,
  indicatorDescriptors,
  drawMode,
  drawings,
  onAddDrawing,
  onLoadEarlier,
  onCrosshair,
}) {
  const el = useRef();
  const surface = useRef();
  const api = useRef();
  const lastIdentity = useRef("");
  const auxiliaryHeightKey = useRef("");
  const onCrosshairRef = useRef(onCrosshair);
  const onDrawingRef = useRef(onAddDrawing);
  const drawModeRef = useRef(drawMode);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [draft, setDraft] = useState(null);
  const barTimes = useMemo(
    () => new Set(bars.map((bar) => bar.time)),
    [bars[0]?.time, bars.at(-1)?.time, bars.length],
  );
  const alignedOI = useMemo(
    () => oiPoints.filter((point) => barTimes.has(point.time)),
    [oiPoints, barTimes],
  );
  const earlierCallback = useRef(onLoadEarlier);
  earlierCallback.current = onLoadEarlier;
  onCrosshairRef.current = onCrosshair;
  onDrawingRef.current = onAddDrawing;
  drawModeRef.current = drawMode;

  useEffect(() => {
    if (!drawMode) setDraft(null);
  }, [drawMode]);

  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setViewportVersion((version) => version + 1);
      });
    };
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#08090A" },
        textColor: "#62676B",
        fontFamily: "ui-monospace,monospace",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#141719" },
        horzLines: { color: "#141719" },
      },
      rightPriceScale: {
        borderColor: "#202326",
        scaleMargins: { top: 0.12, bottom: 0.23 },
      },
      timeScale: { borderColor: "#202326", timeVisible: true, rightOffset: 8 },
      crosshair: {
        mode: 0,
        vertLine: { color: "#52585D", labelBackgroundColor: "#292E31" },
        horzLine: { color: "#52585D", labelBackgroundColor: "#292E31" },
      },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#829B8D",
      downColor: "#9E7979",
      wickUpColor: "#829B8D",
      wickDownColor: "#9E7979",
      borderVisible: true,
      borderUpColor: "#829B8D",
      borderDownColor: "#9E7979",
    });
    const volumes = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart
      .priceScale("volume")
      .applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    const oiLine = chart.addSeries(
      LineSeries,
      {
        color: "#4ED8C8",
        lineWidth: 2,
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        title: "OI",
        crosshairMarkerVisible: true,
      },
      1,
    );
    chart.panes()[1].setHeight(130);
    const markers = createSeriesMarkers(candles, []);
    const onMove = (point) => {
      onCrosshairRef.current?.(point.seriesData.get(candles) || null);
      refresh();
    };
    chart.subscribeCrosshairMove(onMove);
    const report = () => {
      if (!surface.current) return;
      const time = Number(surface.current.dataset.triggerTime);
      const x = time ? chart.timeScale().timeToCoordinate(time) : null;
      surface.current.dataset.triggerPosition =
        x === null ? "" : String(x / chart.timeScale().width());
    };
    const onRange = (range) => {
      report();
      refresh();
      if (range && range.from < 30) earlierCallback.current?.();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refresh);
    resize?.observe(surface.current);
    api.current = {
      chart,
      candles,
      volumes,
      oiLine,
      indicatorSeries: new Map(),
      markers,
      report,
      refresh,
    };
    refresh();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (!bars.length && surface.current)
      surface.current.dataset.triggerPosition = "";
    const min = Math.min(...bars.map((bar) => bar.low));
    a.candles.applyOptions({
      priceFormat: {
        type: "price",
        precision: min < 1 ? 6 : min < 10 ? 4 : 2,
        minMove: min < 1 ? 0.000001 : min < 10 ? 0.0001 : 0.01,
      },
    });
    const markerColor = marker
      ? signalTone(marker) === "normal"
        ? SIGNAL_COLORS.observe
        : signalColor(marker)
      : SIGNAL_COLORS.high;
    const candleData = bars.map((bar) =>
      bar.time === marker?.triggeredAt
        ? { ...bar, borderColor: markerColor }
        : bar,
    );
    const volumeData = bars.map((bar) => ({
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? "#26312D" : "#332829",
    }));
    const sameWindow =
      a.previousIdentity === identity &&
      a.previousFirst === bars[0]?.time &&
      a.previousLength === bars.length &&
      a.previousLast === bars.at(-1)?.time;
    if (sameWindow && bars.length) {
      a.candles.update(candleData.at(-1));
      a.volumes.update(volumeData.at(-1));
    } else {
      const range = a.chart.timeScale().getVisibleLogicalRange();
      const added =
        a.previousIdentity === identity
          ? bars.findIndex((bar) => bar.time === a.previousFirst)
          : 0;
      a.candles.setData(candleData);
      a.volumes.setData(volumeData);
      if (range && added > 0)
        a.chart.timeScale().setVisibleLogicalRange({
          from: range.from + added,
          to: range.to + added,
        });
    }
    a.previousIdentity = identity;
    a.previousFirst = bars[0]?.time;
    a.previousLast = bars.at(-1)?.time;
    a.previousLength = bars.length;
    a.volumes.applyOptions({ visible: volume });
    const index = marker
      ? bars.findIndex((bar) => bar.time === marker.triggeredAt)
      : -1;
    a.markers.setMarkers(
      index >= 0
        ? [
            {
              time: bars[index].time,
              position: "aboveBar",
              shape: "arrowDown",
              color: markerColor,
              text: marker.title,
            },
          ]
        : [],
    );
    if (lastIdentity.current !== identity && bars.length) {
      if (index >= 0)
        a.chart.timeScale().setVisibleLogicalRange(triggerRange(index));
      else
        a.chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, bars.length - 300),
          to: bars.length + 5,
        });
      lastIdentity.current = identity;
      requestAnimationFrame(a.report);
    }
    a.refresh();
  }, [bars, identity, marker, volume]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const wanted = new Set(indicatorDescriptors.map((indicator) => indicator.id));

    for (const [id, existing] of a.indicatorSeries) {
      if (wanted.has(id)) continue;
      existing.series.forEach((series) => a.chart.removeSeries(series));
      a.indicatorSeries.delete(id);
    }

    for (const indicator of indicatorDescriptors) {
      const structure = `${indicator.type}:${indicator.pane}:${indicator.lines
        .map((line) => line.key)
        .join(",")}`;
      let entry = a.indicatorSeries.get(indicator.id);
      if (!entry || entry.structure !== structure) {
        if (entry) entry.series.forEach((series) => a.chart.removeSeries(series));
        const priceLines = [];
        const series = indicator.lines.map((line) => {
          const next = a.chart.addSeries(LineSeries, line.options, indicator.pane);
          if (indicator.type === "rsi") {
            priceLines.push(
              next.createPriceLine({
                price: indicator.levels?.overbought ?? 70,
                color: "#5c4646",
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: false,
                title: "",
              }),
              next.createPriceLine({
                price: indicator.levels?.oversold ?? 30,
                color: "#3d5653",
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: false,
                title: "",
              }),
            );
          }
          return next;
        });
        entry = { structure, series, pane: indicator.pane, priceLines };
        a.indicatorSeries.set(indicator.id, entry);
      }
      entry.series.forEach((series, index) => {
        const line = indicator.lines[index];
        series.applyOptions(line.options);
        series.setData(line.data);
      });
      if (indicator.type === "rsi") {
        entry.priceLines?.[0]?.applyOptions({
          price: indicator.levels?.overbought ?? 70,
        });
        entry.priceLines?.[1]?.applyOptions({
          price: indicator.levels?.oversold ?? 30,
        });
      }
    }

    const hasRsi = indicatorDescriptors.some((indicator) => indicator.pane === 2);
    applyAuxiliaryPaneHeights(a, surface.current, oiVisible, hasRsi);
    a.refresh();
  }, [indicatorDescriptors, identity]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const times = new Set(bars.map((bar) => bar.time));
    a.oiLine.setData(oiVisible ? oiPoints.filter((point) => times.has(point.time)) : []);
    a.oiLine.applyOptions({ visible: oiVisible });
    const hasRsi = indicatorDescriptors.some((indicator) => indicator.pane === 2);
    applyAuxiliaryPaneHeights(a, surface.current, oiVisible, hasRsi);
    a.refresh();
  }, [
    oiPoints,
    oiVisible,
    bars[0]?.time,
    bars.at(-1)?.time,
    identity,
    indicatorDescriptors,
  ]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const hasRsi = indicatorDescriptors.some((indicator) => indicator.pane === 2);
    const key = `${surface.current?.clientHeight || 0}:${oiVisible}:${hasRsi}`;
    if (auxiliaryHeightKey.current === key) return;
    auxiliaryHeightKey.current = key;
    applyAuxiliaryPaneHeights(a, surface.current, oiVisible, hasRsi);
  }, [viewportVersion, oiVisible, indicatorDescriptors]);

  const geometry = useMemo(() => {
    void viewportVersion;
    const a = api.current;
    const width = surface.current?.clientWidth || 0;
    const height = a?.chart.panes()[0]?.getHeight?.() || 0;
    if (!a || !width || !height) return [];
    const position = (point) => {
      const x = a.chart.timeScale().timeToCoordinate(point.time);
      const y = a.candles.priceToCoordinate(point.price);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    };
    return [...drawings, ...(draft ? [{ ...draft, id: "draft" }] : [])]
      .map((drawing) => {
        const start = position(drawing.start);
        const end = position(drawing.end);
        if (!start || !end) return null;
        if (
          drawing.type === "horizontal" &&
          (start.y < 0 || start.y > height)
        )
          return null;
        if (
          drawing.type === "trend" &&
          ((start.y < 0 && end.y < 0) ||
            (start.y > height && end.y > height))
        )
          return null;
        return { ...drawing, start, end, width, dashed: drawing.id === "draft" };
      })
      .filter(Boolean);
  }, [
    drawings,
    draft,
    viewportVersion,
    identity,
    bars.length,
    bars[0]?.time,
    bars.at(-1)?.time,
  ]);

  const pointFromEvent = (event) => {
    const a = api.current;
    const rect = surface.current?.getBoundingClientRect();
    if (!a || !rect) return null;
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const mainPaneHeight = a.chart.panes()[0]?.getHeight?.() || rect.height;
    if (y > mainPaneHeight) return null;
    const time = a.chart.timeScale().coordinateToTime(x);
    const price = a.candles.coordinateToPrice(y);
    const normalizedTime = Number(time);
    const normalizedPrice = Number(price);
    if (!Number.isFinite(normalizedTime) || !Number.isFinite(normalizedPrice))
      return null;
    return { time: normalizedTime, price: normalizedPrice, x, y };
  };

  const onPointerDown = (event) => {
    const mode = drawModeRef.current;
    if (!mode || event.button !== 0) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (mode === "horizontal") {
      const drawing = chartDrawing({ type: "horizontal", start: point });
      if (drawing) onDrawingRef.current?.(drawing);
      return;
    }
    setDraft({ type: "trend", start: point, end: point, x: point.x, y: point.y });
  };

  const onPointerMove = (event) => {
    if (!draft) return;
    const point = pointFromEvent(event);
    if (point) setDraft((previous) => (previous ? { ...previous, end: point } : previous));
  };

  const finishDrawing = (event) => {
    if (!draft) return;
    const point = pointFromEvent(event) || draft.end;
    const moved =
      Math.abs(point.x - draft.x) >= 3 || Math.abs(point.y - draft.y) >= 3;
    if (moved) {
      const drawing = chartDrawing({
        type: "trend",
        start: draft.start,
        end: point,
      });
      if (drawing) onDrawingRef.current?.(drawing);
    }
    setDraft(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={surface}
      className={`candle-chart${drawMode ? " is-drawing" : ""}`}
      aria-label="K线图，可拖动缩放；可使用趋势线或水平线工具绘制"
      data-trigger-time={marker?.triggeredAt || ""}
      data-bar-count={bars.length}
      data-oi-count={oiVisible ? alignedOI.length : 0}
      data-drawing-count={drawings.length}
      data-indicator-count={indicatorDescriptors.length}
    >
      <div ref={el} className="candle-chart-surface" />
      <svg
        className="chart-drawings"
        aria-hidden="true"
        focusable="false"
        width="100%"
        height="100%"
      >
        {geometry.map((drawing) =>
          drawing.type === "horizontal" ? (
            <line
              key={drawing.id}
              className={`chart-drawing chart-drawing-horizontal${
                drawing.dashed ? " is-draft" : ""
              }`}
              x1="0"
              y1={drawing.start.y}
              x2={drawing.width}
              y2={drawing.start.y}
            />
          ) : (
            <line
              key={drawing.id}
              className={`chart-drawing chart-drawing-trend${
                drawing.dashed ? " is-draft" : ""
              }`}
              x1={drawing.start.x}
              y1={drawing.start.y}
              x2={drawing.end.x}
              y2={drawing.end.y}
            />
          ),
        )}
      </svg>
      {drawMode && (
        <div
          className="chart-drawing-capture"
          aria-label={
            drawMode === "horizontal"
              ? "点击 K 线添加水平线"
              : "在 K 线区域拖动添加趋势线"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrawing}
          onPointerCancel={() => setDraft(null)}
          onContextMenu={(event) => event.preventDefault()}
        />
      )}
    </div>
  );
}
export default function ChartPanel({
  selection,
  onSelect,
  provider,
  mode,
  onWatch,
  onIgnore,
  onPlan,
  watched,
  ignored,
  onToggleWatch,
  watchOpen,
}) {
  const [bars, setBars] = useState([]),
    [streamState, setStreamState] = useState("connecting"),
    [loadedIdentity, setLoadedIdentity] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [historyState, setHistoryState] = useState("ready"),
    [volume, setVolume] = useState(true),
    [oiVisible, setOiVisible] = useState(true),
    [indicators, setIndicators] = useState(() =>
      decodeChartIndicators(storage.read(`chart-indicators:${mode}`, null)),
    ),
    [indicatorSettingsOpen, setIndicatorSettingsOpen] = useState(false),
    [drawMode, setDrawMode] = useState(null),
    [drawingsByChart, setDrawingsByChart] = useState({}),
    [oiData, setOiData] = useState({identity:"",points:[],loading:true,error:""}),
    [hover, setHover] = useState(null),
    [updated, setUpdated] = useState(null),
    [symbol, setSymbol] = useState(selection.symbol);
  const identity = [
    mode,
    selection.symbol,
    selection.timeframe,
    selection.signal?.id || "",
    selection.signal?.triggeredAt || "",
  ].join(":");
  const drawingKey = [mode, selection.symbol, selection.timeframe].join(":");
  const drawings = drawingsByChart[drawingKey] || [];
  const historyRequest = useRef({identity, busy:false, ended:false});
  if (historyRequest.current.identity !== identity) historyRequest.current = {identity,busy:false,ended:false};
  const indicatorStorageKey = `chart-indicators:${mode}`;
  useEffect(() => {
    setDrawMode(null);
  }, [drawingKey]);
  useEffect(() => {
    setIndicators(decodeChartIndicators(storage.read(indicatorStorageKey, null)));
    setIndicatorSettingsOpen(false);
  }, [indicatorStorageKey]);
  useEffect(() => {
    storage.write(indicatorStorageKey, encodeChartIndicators(indicators));
  }, [indicatorStorageKey, indicators]);
  useEffect(() => {
    const cancelDrawing = (event) => {
      if (event.key !== "Escape") return;
      setDrawMode(null);
      setIndicatorSettingsOpen(false);
    };
    window.addEventListener("keydown", cancelDrawing);
    return () => window.removeEventListener("keydown", cancelDrawing);
  }, []);
  useEffect(() => {
    setHistoryState("ready");
    let alive = true,
      busy = false,
      retry = false;
    const live = mode === "LIVE" && !selection.signal;
    let pending = [],
      ready = false,
      lastEvent = 0,
      lastLoad = 0;
    setStreamState(live ? "connecting" : "history");
    setBars([]);
    setHover(null);
    setLoading(true);
    setError("");
    setUpdated(null);
    setSymbol(selection.symbol);
    async function load() {
      if (busy) {
        retry = true;
        return;
      }
      busy = true;
      lastLoad = Date.now();
      try {
        const data = await provider.getKlines(
          selection.symbol,
          selection.timeframe,
          selection.signal?.triggeredAt,
          live,
        );
        if (alive) {
          setBars(previous =>
            live
              ? mergeKlines(previous, mergeKlines(data, pending, 50000), 50000)
              : mergeKlines(previous, chartWindow(data, selection.signal?.triggeredAt, 1000), 50000),
          );
          ready = true;
          if (live)
            setStreamState(
              lastEvent && Date.now() - lastEvent < 10000 ? "live" : "waiting",
            );
          setLoadedIdentity(identity);
          setError(
            !selection.signal &&
              mode === "LIVE" &&
              data.length &&
              Date.now() / 1000 - data.at(-1).time >
                SECONDS[selection.timeframe] * 2
              ? "Data delayed · 最新K线时间落后于当前周期"
              : "",
          );
          setUpdated(Date.now());
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        busy = false;
        if (alive) {
          setLoading(false);
          if (retry) {
            retry = false;
            void load();
          }
        }
      }
    }
    let unsubscribe;
    if (live) {
      // Load the history once, then merge the browser WebSocket's live bars.
      // Chart rendering never waits for a first realtime event.
      void load();
      unsubscribe = provider.subscribeKlines(
        selection.symbol,
        selection.timeframe,
        (bar) => {
          if (!alive) return;
          lastEvent = Date.now();
          pending = mergeKlines(pending, [bar]);
          if (ready) {
            setBars((previous) => mergeKlines(previous, [bar], 50000));
            setStreamState("live");
          }
          setUpdated((previous) => Math.max(previous || 0, bar.eventTime));
        },
        (state) => {
          if (!alive) return;
          setStreamState(state);
          if (state === "reconnecting") setLoading(false);
        },
      );
    } else load();
    const timer = setInterval(
      () => {
        if (!live) load();
        // This is a receive-health check only. It never refreshes live K lines
        // over REST; the WebSocket subscription above owns active-bar updates.
        else if (lastEvent && Date.now() - lastEvent > 25000)
          setStreamState("delayed");
      },
      live ? 10000 : 15000,
    );
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [identity, provider]);
  useEffect(() => {
    let alive = true, busy = false;
    setOiData(previous => ({identity,points:previous.identity===identity?previous.points:[],loading:true,error:""}));
    if (!oiVisible || loadedIdentity !== identity || !bars.length) return;
    async function loadOI() {
      if (busy) return;
      busy = true;
      try {
        const points = await provider.getOIHistory(selection.symbol,selection.timeframe,selection.signal?.triggeredAt,bars[0].time,bars.at(-1).time);
        if (alive) setOiData({identity,points,loading:false,error:""});
      } catch (e) {
        if (alive) setOiData(previous => ({...previous,loading:false,error:e.message}));
      } finally {busy=false;}
    }
    void loadOI();
    const timer=setInterval(loadOI,60000);
    return () => {alive=false;clearInterval(timer);};
  }, [identity,provider,oiVisible,loadedIdentity,bars[0]?.time,bars.at(-1)?.time]);
  const oiPoints = oiData.identity === identity ? oiData.points : [];
  const renderedBars = loadedIdentity === identity ? bars : [];
  // New WebSocket bars can arrive several times before the browser has an idle
  // frame. Deferring the expensive indicator recalculation keeps drawing and
  // chart navigation responsive while still catching up to the live candle.
  const deferredIndicatorBars = useDeferredValue(renderedBars);
  const indicatorDescriptors = useMemo(
    () => makeIndicatorDescriptors(indicators, deferredIndicatorBars),
    [indicators, deferredIndicatorBars],
  );
  const enabledIndicators = indicators.filter((indicator) => indicator.enabled);
  const addIndicator = (type) => {
    setIndicators((current) => createChartIndicator(type, current));
  };
  const updateIndicator = (id, patch) => {
    setIndicators((current) =>
      normalizeChartIndicators(
        current.map((indicator) =>
          indicator.id === id ? { ...indicator, ...patch } : indicator,
        ),
      ),
    );
  };
  const removeIndicator = (id) => {
    setIndicators((current) => current.filter((indicator) => indicator.id !== id));
  };
  const resetIndicators = () => setIndicators(decodeChartIndicators(null));
  const addDrawing = (drawing) => {
    setDrawingsByChart((previous) => ({
      ...previous,
      [drawingKey]: [...(previous[drawingKey] || []), drawing].slice(-50),
    }));
  };
  const clearDrawings = () => {
    setDrawingsByChart((previous) => ({ ...previous, [drawingKey]: [] }));
    setDrawMode(null);
  };
  async function loadEarlier() {
    const request = historyRequest.current;
    if (!provider.getEarlierKlines || request.busy || request.ended || !renderedBars.length || renderedBars.length >= 50000) return;
    request.busy = true; setHistoryState("loading");
    const before = renderedBars[0].time;
    try {
      const data = (await provider.getEarlierKlines(selection.symbol, selection.timeframe, before)).filter(b => b.time < before);
      if (historyRequest.current !== request) return;
      request.ended = !data.length;
      setBars(previous => mergeKlines(data, previous, 50000));
      setHistoryState(request.ended ? "ended" : "ready");
    } catch { if (historyRequest.current === request) setHistoryState("error"); }
    finally {request.busy = false;}
  }
  const b = loadedIdentity === identity ? hover || bars.at(-1) : null;
  const fmt = (n) =>
    n?.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 }) ?? "—";
  // This is deliberately calculated from the same candle shown in the OHLC
  // strip. When the crosshair moves, `hover` changes to that candle rather
  // than comparing against a different/latest bar.
  const changePercent = candleChangePercent(b);
  const changeClass =
    changePercent === null
      ? ""
      : changePercent > 0
        ? "positive"
        : changePercent < 0
          ? "negative"
          : "neutral";
  const fmtChange = (value) =>
    Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
  return (
    <section className="chart-panel">
      <div className="chart-toolbar">
        <div className="instrument">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (/^[\p{L}\p{N}]{3,40}$/u.test(symbol))
                onSelect({
                  symbol: symbol.endsWith("USDT") ? symbol : symbol + "USDT",
                  timeframe: selection.timeframe,
                });
            }}
          >
            <label className="sr-only" htmlFor="symbol">
              交易标的
            </label>
            <input
              id="symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
            <button aria-label="切换标的" title="切换标的">
              ⌕
            </button>
          </form>
          <ContractPicker mode={mode} timeframe={selection.timeframe} onSelect={onSelect} />
          <MarketSummary symbol={selection.symbol} mode={mode} />
        </div>
        <button
          className="watch-toggle"
          aria-expanded={watchOpen}
          onClick={onToggleWatch}
        >
          {watchOpen ? "收起观察池" : "观察池"} ▤
        </button>
        <div className="timeframes">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              className={t === selection.timeframe ? "active" : ""}
              onClick={() =>
                onSelect({ symbol: selection.symbol, timeframe: t })
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="ohlc">
        <strong>
          {selection.symbol.replace("USDT", "")} <span>/ USDT</span>
        </strong>
        {[
          ["O", b?.open],
          ["H", b?.high],
          ["L", b?.low],
          ["C", b?.close],
        ].map(([k, v]) => (
          <span key={k}>
            {k} <b className={k === "C" ? changeClass : ""}>{fmt(v)}</b>
          </span>
        ))}
        <span className="ohlc-change">
          涨跌 <b className={changeClass}>{fmtChange(changePercent)}</b>
        </span>
        <label>
          <input
            type="checkbox"
            checked={volume}
            onChange={(e) => setVolume(e.target.checked)}
          />{" "}
          VOL
        </label>
        <label><input type="checkbox" checked={oiVisible} onChange={e=>setOiVisible(e.target.checked)} /> OI</label>
      </div>
      <div className="chart-tools" role="toolbar" aria-label="K 线工具">
        <div className="chart-tool-group" aria-label="绘图工具">
          <span className="chart-tool-label">绘图</span>
          <button
            type="button"
            className={drawMode === "trend" ? "active" : ""}
            aria-pressed={drawMode === "trend"}
            onClick={() =>
              setDrawMode((current) =>
                current === "trend" ? null : "trend",
              )
            }
          >
            趋势线
          </button>
          <button
            type="button"
            className={drawMode === "horizontal" ? "active" : ""}
            aria-pressed={drawMode === "horizontal"}
            onClick={() =>
              setDrawMode((current) =>
                current === "horizontal" ? null : "horizontal",
              )
            }
          >
            水平线
          </button>
          <button
            type="button"
            className="chart-clear-drawings"
            disabled={!drawings.length}
            onClick={clearDrawings}
          >
            清除绘制
          </button>
        </div>
        <div className="chart-tool-group chart-indicators" aria-label="图表指标">
          <span className="chart-tool-label">指标</span>
          <button
            type="button"
            className={indicatorSettingsOpen ? "active" : ""}
            aria-expanded={indicatorSettingsOpen}
            aria-controls="chart-indicator-settings"
            onClick={() => setIndicatorSettingsOpen((open) => !open)}
          >
            指标设置{enabledIndicators.length ? ` ${enabledIndicators.length}` : ""} ▾
          </button>
          {enabledIndicators.slice(0, 3).map((indicator) => (
            <span
              key={indicator.id}
              className="chart-indicator-chip"
              style={{ "--indicator-color": indicator.color }}
              title={`${chartIndicatorLabel(indicator)} · 在指标设置中编辑`}
            >
              {chartIndicatorLabel(indicator)}
            </span>
          ))}
          {enabledIndicators.length > 3 && (
            <span className="chart-indicator-chip more">
              +{enabledIndicators.length - 3}
            </span>
          )}
        </div>
        <span className="chart-tool-hint" role="status">
          {drawMode === "trend"
            ? "在主图拖动绘制趋势线 · Esc 取消"
            : drawMode === "horizontal"
              ? "点击主图添加水平线 · Esc 取消"
              : "趋势线拖动绘制 · 水平线点击添加"}
        </span>
      </div>
      {indicatorSettingsOpen && (
        <div id="chart-indicator-settings" className="chart-indicator-panel">
          <IndicatorSettings
            indicators={indicators}
            onAdd={addIndicator}
            onChange={updateIndicator}
            onRemove={removeIndicator}
            onReset={resetIndicators}
          />
        </div>
      )}
      <div className="chart-wrap">
        <CandleChart
          bars={renderedBars}
          identity={identity}
          marker={selection.signal}
          volume={volume}
          onLoadEarlier={loadEarlier}
          oiPoints={oiPoints}
          oiVisible={oiVisible}
          indicatorDescriptors={indicatorDescriptors}
          drawMode={drawMode}
          drawings={drawings}
          onAddDrawing={addDrawing}
          onCrosshair={setHover}
        />
        {oiVisible && <div className="oi-legend" role="status">
          <strong>OI 持仓量</strong> · {mode === "DEMO" ? "模拟数据" : "币安合约"} · {selection.timeframe} 采样 / 60s 刷新 · {oiPoints.length} 点 / {renderedBars.length} 根 K线 · 最多近30天
          <span>{oiData.loading ? "加载中…" : oiData.error ? "数据暂不可用 · " + oiData.error : oiPoints.length ? `${fmt(oiPoints.at(-1).value)} ${selection.symbol.replace(/USDT$/, "")} · ${new Date(oiPoints.at(-1).time*1000).toLocaleString("zh-CN")}` : "该时间段暂无 OI，历史最多近 30 天"}</span>
        </div>}
        <span className="chart-watermark">
          {selection.symbol.replace("USDT", "")}{" "}
          <small>{selection.timeframe}</small>
        </span>
        {loading && <div className="chart-overlay">正在加载 K 线…</div>}
        {error && (
          <div className="chart-error" role="alert">
            {bars.length ? "Data delayed" : "Provider error"} · {error}
          </div>
        )}
      </div>
      <div className="chart-caption">
        {mode === "LIVE" && <button className="return-live" disabled={historyState === "loading" || historyState === "ended" || renderedBars.length >= 50000} onClick={loadEarlier}>{historyState === "loading" ? "加载历史…" : historyState === "ended" ? "已到最早数据" : renderedBars.length >= 50000 ? "已达 5 万根" : historyState === "error" ? "历史加载失败 · 重试" : "加载更早历史"} · {renderedBars.length} 根</button>}
        <span>
          <i
            className={
              error || ["reconnecting", "delayed"].includes(streamState)
                ? "dot warning"
                : "dot"
            }
          />{" "}
          {mode === "DEMO"
            ? "模拟 K 线"
            : updated
              ? selection.signal
                ? "Binance · 触发窗口"
                : {
                    live: "币安 K 线 · 实时推送",
                    connecting: "正在连接币安实时行情",
                    connected: "币安实时连接已建立",
                    waiting: "等待首个币安实时更新",
                    reconnecting: "币安实时连接中断 · 自动重试",
                    delayed: "币安实时更新延迟 · 等待恢复",
                  }[streamState] || "连接中"
              : streamState === "reconnecting"
                ? "连接中断 · 自动重连"
                : "连接中"}
          {updated && " · " + new Date(updated).toLocaleTimeString("zh-CN")}
        </span>
        {mode === "LIVE" && selection.signal && (
          <button
            className="return-live"
            onClick={() =>
              onSelect({
                symbol: selection.symbol,
                timeframe: selection.timeframe,
              })
            }
          >
            回到实时 ↗
          </button>
        )}
        <span className="trigger-status">
          {selection.signal
            ? renderedBars.some((b) => b.time === selection.signal.triggeredAt)
              ? "↘ 触发位置已标记"
              : loading
                ? "定位中…"
                : "触发K线不可用"
            : "滚轮缩放 · 拖动平移"}
        </span>
      </div>
      <div className="current-signal-bar">
        <div
          className="current-summary"
          title={
            selection.signal
              ? `${new Date(selection.signal.triggeredAt * 1000).toLocaleString("zh-CN")} · 触发价 ${fmt(selection.signal.triggerPrice)}${selection.signal.type === "oi" ? " · OI 与主图均为 USDT 永续合约" : ""}`
              : "从左侧选择信号"
          }
        >
          <span className="current-identity">
            {selection.symbol.replace("USDT", "")} <i>·</i>{" "}
            {selection.timeframe}
          </span>
          <strong>{selection.signal?.title || "自由看图"}</strong>
          <span className="current-value">
            {selection.signal?.value || "选择信号开始判断"}
          </span>
        </div>
        <div className="quick-actions">
          <button className={watched ? "is-watched" : ""} onClick={onWatch}>
            {watched ? "✓ 观察中" : "＋ 观察池"} <kbd>W</kbd>
          </button>
          <button disabled={!selection.signal || ignored} onClick={onIgnore}>
            忽略 <kbd>X</kbd>
          </button>
          <button onClick={onPlan}>
            创建计划 <kbd>P</kbd>
          </button>
        </div>
      </div>
    </section>
  );
}
