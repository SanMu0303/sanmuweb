import React, { useEffect, useMemo, useState, useRef } from "react";
import SignalFeed from "./components/SignalFeed.jsx";
import ContractHeatPanel from "./components/ContractHeatPanel.jsx";
import ChartPanel from "./components/ChartPanel.jsx";
import WatchlistPanel from "./components/WatchlistPanel.jsx";
import TradePlanModal from "./components/TradePlanModal.jsx";
import { providers } from "./providers/index.mjs";
import { demoWatchlist } from "./providers/mock.mjs";
import { storage } from "./storage.mjs";
import { DEFAULTS, decodeScannerConfig, encodeScannerConfig, validateConfig } from "./scanner/config.mjs";
import {
  acceptSignals,
  ignoreKey,
  localDay,
} from "./scanner/SignalScanner.mjs";
import VoiceAlerts from "./components/VoiceAlerts.jsx";
import SignalFilters from "./components/SignalFilters.jsx";
import { shortcutAction, navigationTarget } from "./shortcuts.mjs";
import { activeSignals, filterSignals, signalStatus } from "./filters.mjs";
import { decorateContractHeatItems, directBinanceContractHeat } from "./contractHeat.mjs";

function Settings({ config, onSave, onClose }) {
  const [error, setError] = useState("");
  const labels = {
    minQuoteVolumeM: "最低 24H 成交额（M USDT，0 关闭）",
    maxVolumeRank: "K线 / OI 扫描成交额前 N（0 使用安全上限）",
    volume: "成交量阈值（近 20 根均量倍数）",
    oi1h: "OI 1H 涨幅 %",
    oi4h: "OI 4H 涨幅 %",
    price1h: "价格 1H 波动 %",
    price4h: "价格 4H 波动 %",
    price24h: "价格 24H 波动 %",
    cooldown: "信号冷却（分钟）",
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">SCANNER SETTINGS</span>
            <h2 id="settings-title">信号扫描设置</h2>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onSave(
                validateConfig(
                  Object.fromEntries(new FormData(e.currentTarget)),
                ),
              );
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <div className="form-grid">
            {Object.entries(labels).map(([k, v]) => (
              <label key={k}>
                {v}
                <input
                  name={k}
                  type="number"
                  required
                  step={k === "maxVolumeRank" || k === "cooldown" ? 1 : 0.1}
                  min={["minQuoteVolumeM","maxVolumeRank"].includes(k) ? 0 : k === "cooldown" ? 30 : 0.1}
                  max={k === "cooldown" ? 1440 : undefined}
                  defaultValue={config[k] ?? DEFAULTS[k]}
                />
              </label>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          <p className="muted">
            LIVE 会在此终端打开时直连币安 USDⓈ-M 公共行情流。价格异动走全市场行情流；成交量、新高新低与 OI 以设置中的流动性范围扫描。成交量按近 20 根均量比较，OI 只提示增长。阈值只保存在当前浏览器；关闭终端后不会继续后台扫描。
          </p>
          <button className="primary">保存设置</button>
        </form>
      </section>
    </div>
  );
}
function Desk({ mode, onMode }) {
  const key = (k) => (mode === "LIVE" ? "LIVE:usdm" : mode) + ":" + k;
  const [signals, setSignals] = useState(() =>
      activeSignals(storage.read(key("signals"), [])),
    ),
    [watchlist, setWatchlist] = useState(() =>
      storage.read(key("watchlist"), mode === "DEMO" ? demoWatchlist : []),
    ),
    [plans, setPlans] = useState(() => storage.read(key("plans"), [])),
    [ignored, setIgnored] = useState(() => storage.read(key("ignored"), {})),
    [filters, setFilters] = useState(() =>
      storage.read(key("filters"), {
        timeframe: "all",
        type: "all",
        watched: false,
      }),
    ),
    [config, setConfig] = useState(() =>
      decodeScannerConfig(storage.read(key("config"), {})),
    ),
    [selection, setSelection] = useState({
      symbol: "DOGEUSDT",
      timeframe: "1H",
    }),
    [status, setStatus] = useState({ state: "loading" }),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(""),
    [mobileTab, setMobileTab] = useState("chart"),
    [storageError, setStorageError] = useState(false),
    [contractHeat, setContractHeat] = useState({
      items: [],
      state: mode === "LIVE" ? "loading" : "demo",
      error: "",
      asOf: null,
      stale: false,
      source: "binance-usdm",
      universeSize: null,
    });
  const [statusTab, setStatusTab] = useState("unread"),
    [watchOpen, setWatchOpen] = useState(false);
  const navigation = useRef([]),
    previewed = useRef(false),
    heatRanks = useRef(new Map()),
    heatHasSnapshot = useRef(false);
  const provider = providers[mode];
  useEffect(() => {
    const values = { signals, watchlist, plans, ignored, filters };
    const valuesFailed = Object.entries(values).some(([k, v]) =>
      !storage.write(key(k), v),
    );
    const configSaved = storage.write(
      key("config"),
      encodeScannerConfig(config),
    );
    setStorageError(valuesFailed || !configSaved);
  }, [signals, watchlist, plans, ignored, filters, config]);
  useEffect(() => {
    let alive = true;
    let timer = null;

    if (mode !== "LIVE") {
      heatRanks.current = new Map();
      heatHasSnapshot.current = false;
      setContractHeat({
        items: [],
        state: "demo",
        error: "",
        asOf: null,
        stale: false,
        source: "binance-usdm",
        universeSize: null,
      });
      return undefined;
    }

    async function loadContractHeat() {
      setContractHeat((previous) => ({
        ...previous,
        state: previous.items.length ? "refreshing" : "loading",
        error: "",
      }));
      try {
        let payload;
        let apiError = null;
        try {
          const response = await fetch(
            "/api/signal-desk/contract-heat/?source=binance-usdm",
            {
              headers: { Accept: "application/json" },
              cache: "no-store",
            },
          );
          if (!response.ok) {
            throw new Error(`热度接口返回 ${response.status}`);
          }
          payload = await response.json();
          if (!Array.isArray(payload?.items)) {
            throw new Error("热度接口未返回榜单数据");
          }
        } catch (error) {
          apiError = error;
          // The same-origin API is preferred because it amortises public
          // Binance reads. If it is regionally unavailable, read the fixed
          // Binance USDⓈ-M public endpoints directly in this browser instead.
          // The fallback is bounded and labelled as browser-direct below.
          payload = await directBinanceContractHeat();
        }
        const snapshot = decorateContractHeatItems(
          payload.items,
          heatRanks.current,
          heatHasSnapshot.current,
        );
        heatRanks.current = snapshot.nextRanks;
        heatHasSnapshot.current = true;
        if (alive) {
          setContractHeat({
            items: snapshot.items,
            state: "ready",
            error: "",
            asOf: payload.asOf || Date.now(),
            stale: Boolean(payload.stale),
            fallback: Boolean(payload.fallback || apiError),
            source: payload.source || "binance-usdm",
            universeSize: Number.isFinite(
              Number(payload.universeSize ?? payload.candidateCount),
            )
              ? Number(payload.universeSize ?? payload.candidateCount)
              : null,
          });
        }
      } catch (error) {
        if (alive) {
          setContractHeat((previous) => ({
            ...previous,
            state: "error",
            stale: previous.items.length > 0,
            error:
              error instanceof Error ? error.message : "热度数据请求失败",
          }));
        }
      }
    }

    void loadContractHeat();
    timer = window.setInterval(loadContractHeat, 60_000);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [mode]);
  useEffect(() => {
    let alive = true,
      busy = false;
    async function poll() {
      if (busy) return;
      busy = true;
      try {
        if (mode === "LIVE") await provider.configure(config);
        const result = await provider.getSignals();
        if (alive) {
          setStatus(result.status);
          setSignals((prev) =>
            acceptSignals(result.signals, prev, ignored, config),
          );
        }
      } catch (e) {
        if (alive)
          setStatus((s) => ({ ...s, state: "error", message: e.message }));
      } finally {
        busy = false;
      }
    }
    let unsubscribe;
    if (mode === "LIVE") {
      provider
        .configure(config)
        .then(() => {
          if (!alive) return;
          unsubscribe = provider.subscribeSignals(
            (result) => {
              if (!alive) return;
              setStatus(result.status);
              if (result.signals.length)
                setSignals((prev) =>
                  acceptSignals(result.signals, prev, ignored, config),
                );
            },
            () => {
              if (alive)
                setStatus((s) => ({
                  ...s,
                  state: "delayed",
                  message: "信号连接中断，自动重连中",
                }));
            },
          );
        })
        .catch((e) => {
          if (alive)
            setStatus((s) => ({ ...s, state: "error", message: e.message }));
        });
    } else poll();
    const t = mode === "DEMO" ? setInterval(poll, 45000) : null;
    return () => {
      alive = false;
      clearInterval(t);
      unsubscribe?.();
    };
  }, [provider, config, ignored]);
  useEffect(() => {
    if (!previewed.current && signals.length) {
      previewed.current = true;
      const first = signals.find(
        (s) => (s.status || "unread") === "unread" && !ignored[ignoreKey(s)],
      );
      if (first) {
        setSelection({
          symbol: first.symbol,
          timeframe: first.timeframe,
          signal: first,
        });
        navigation.current = signals
          .filter((s) => (s.status || "unread") === "unread")
          .map((s) => s.id);
      }
    }
  }, [signals, ignored]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const listener = (e) => {
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement,
      dialog = document.querySelector("[role=dialog]");
    const targets = () =>
      [
        ...dialog.querySelectorAll("button,input,select,textarea,[tabindex]"),
      ].filter((el) => !el.disabled);
    targets()[0]?.focus();
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const list = targets(),
        first = list[0],
        last = list.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal]);
  const classified = useMemo(
    () => signals.map((s) => ({ ...s, status: signalStatus(s, ignored) })),
    [signals, ignored],
  );
  const visible = useMemo(
    () =>
      filterSignals(
        classified,
        { ...filters, status: statusTab },
        watchlist,
        ignored,
      ),
    [classified, filters, statusTab, watchlist, ignored],
  );
  const counts = Object.fromEntries(
    ["unread", "viewed", "watchlist", "ignored"].map((status) => [
      status,
      filterSignals(classified, { ...filters, status }, watchlist, ignored)
        .length,
    ]),
  );
  const activeSelection = {
    ...selection,
    signal:
      classified.find((s) => s.id === selection.signal?.id) || selection.signal,
  };
  const select = (s, capture = true) => {
    previewed.current = true;
    if (capture) navigation.current = visible.map((x) => x.id);
    setSelection({ symbol: s.symbol, timeframe: s.timeframe, signal: s });
    setSignals((prev) =>
      prev.map((x) =>
        x.id === s.id && (x.status || "unread") === "unread"
          ? { ...x, status: "viewed" }
          : x,
      ),
    );
    setMobileTab("chart");
  };
  function navigate(direction) {
    const ids = [
      ...new Set([...navigation.current, ...visible.map((s) => s.id)]),
    ];
    const next = navigationTarget(
      ids,
      classified,
      selection.signal?.id,
      direction,
    );
    if (next) {
      navigation.current = ids;
      select(next, false);
    } else setNotice(direction > 0 ? "已到队列末尾" : "已到队列开头");
  }
  useEffect(() => {
    const handler = (e) => {
      const action = shortcutAction(e, !!modal);
      if (!action) return;
      e.preventDefault();
      if (action === "next") navigate(1);
      if (action === "previous") navigate(-1);
      if (action === "watch") addWatch();
      if (action === "ignore") ignore();
      if (action === "plan") setModal("plan");
      if (action === "help") setModal("shortcuts");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const watched = watchlist.some(
    (w) => w.symbol === selection.symbol && w.timeframe === selection.timeframe,
  );
  function addWatch() {
    if (!watched)
      setWatchlist((prev) => [
        {
          symbol: selection.symbol,
          timeframe: selection.timeframe,
          market: "Crypto",
          stage: "preparation",
          waitingFor: "",
          note: "",
          addedAt: Date.now(),
        },
        ...prev,
      ]);
    if (selection.signal && ignored[ignoreKey(selection.signal)])
      setIgnored((prev) => {
        const next = { ...prev };
        delete next[ignoreKey(selection.signal)];
        return next;
      });
    if (selection.signal)
      setSignals((prev) =>
        prev.map((s) =>
          s.id === selection.signal.id ? { ...s, status: "watchlist" } : s,
        ),
      );
    setNotice("已加入观察池 · 可在右侧填写等待条件");
  }
  function ignore() {
    if (!selection.signal || activeSelection.signal?.status === "ignored")
      return;
    const target = selection.signal;
    setIgnored((prev) => ({ ...prev, [ignoreKey(target)]: true }));
    setSignals((prev) =>
      prev.map((s) =>
        s.symbol === target.symbol && s.type === target.type
          ? { ...s, status: "ignored" }
          : s,
      ),
    );
    const ids = [
      ...new Set([...navigation.current, ...visible.map((s) => s.id)]),
    ];
    const remaining = classified.filter(
      (s) => s.symbol !== target.symbol || s.type !== target.type,
    );
    const index = ids.indexOf(target.id);
    const next =
      ids
        .slice(index + 1)
        .map((id) =>
          remaining.find((s) => s.id === id && s.status !== "ignored"),
        )
        .find(Boolean) || remaining.find((s) => s.status === "unread");
    if (next) {
      navigation.current = ids;
      select(next, false);
    } else setSelection({ symbol: target.symbol, timeframe: target.timeframe });
    setNotice("已忽略 · 今天不再显示该标的同类信号");
  }
  return (
    <div className={`app mobile-${mobileTab} ${watchOpen ? "watch-open" : ""}`}>
      <header className="topbar">
        <div className="brand" title="趋势交易信号工作台">
          <span className="brand-mark">⌁</span>
          <h1>
            SIGNAL<span>DESK</span>
          </h1>
        </div>
        <SignalFilters
          filters={filters}
          onChange={(f) => {
            setFilters(f);
            navigation.current = [];
          }}
        />
        <div className="header-actions">
          <VoiceAlerts signals={classified} mode={mode} />
          <div className="mode-switch" aria-label="数据模式">
            {["DEMO", "LIVE"].map((m) => (
              <button
                key={m}
                title={
                  m === "DEMO"
                    ? "使用模拟行情与信号"
                    : "使用 Binance USDT 永续合约真实行情"
                }
                className={mode === m ? "active" : ""}
                onClick={() => onMode(m)}
              >
                {mode === m && <i className="dot" />}
                {m}
              </button>
            ))}
          </div>
          <button
            className="settings-button"
            aria-label="扫描设置"
            title="扫描设置"
            onClick={() => setModal("settings")}
          >
            ⚙
          </button>
        </div>
      </header>
      {mode === "LIVE" && ["error", "delayed"].includes(status.state) && (
        <div className="warning-banner">
          {status.state === "error" ? "Provider error" : "Data delayed"} ·{" "}
          {status.message}
        </div>
      )}
      {status.turnoverError && mode === "LIVE" && <div className="warning-banner">{status.turnoverError}</div>}
      {status.oiError && mode === "LIVE" && (
        <div className="warning-banner">
          OI Provider error · {status.oiError} · OI 限速重试中；未使用模拟 OI
        </div>
      )}
      {storageError && (
        <div className="warning-banner">
          浏览器存储不可用，本次更改可能无法保存。
        </div>
      )}
      <nav className="mobile-nav">
        {[
          ["heat", "热度"],
          ["feed", "信号流"],
          ["chart", "K线图"],
          ["watch", "观察池"],
        ].map(([k, v]) => (
          <button
            key={k}
            className={mobileTab === k ? "active" : ""}
            onClick={() => setMobileTab(k)}
          >
            {v}
          </button>
        ))}
      </nav>
      <main className="workspace">
        <ContractHeatPanel
          {...contractHeat}
          selectedSymbol={selection.symbol}
          onSelect={(item) => {
            const symbol = String(item.symbol || "").toUpperCase();
            if (!symbol) return;
            setSelection({ symbol, timeframe: "1H" });
            setMobileTab("chart");
          }}
        />
        <SignalFeed
          signals={visible}
          onSelect={select}
          selected={selection.signal?.id}
          counts={counts}
          statusTab={statusTab}
          onStatus={(s) => {
            setStatusTab(s);
            navigation.current = [];
          }}
          status={status}
        />
        <ChartPanel
          selection={activeSelection}
          onSelect={setSelection}
          provider={provider}
          mode={mode}
          onWatch={addWatch}
          onIgnore={ignore}
          onPlan={() => setModal("plan")}
          watched={watched}
          ignored={activeSelection.signal?.status === "ignored"}
          onToggleWatch={() => setWatchOpen((v) => !v)}
          watchOpen={watchOpen}
        />
        <WatchlistPanel
          onClose={() => setWatchOpen(false)}
          items={watchlist}
          onChange={(items) => {
            setWatchlist(items);
            setSignals((prev) =>
              prev.map((s) =>
                s.status === "watchlist" &&
                !items.some(
                  (w) => w.symbol === s.symbol && w.timeframe === s.timeframe,
                )
                  ? { ...s, status: "viewed" }
                  : s,
              ),
            );
          }}
          onSelect={(item) => {
            setSelection({ symbol: item.symbol, timeframe: item.timeframe });
            setMobileTab("chart");
          }}
          plans={plans}
          onOpenPlans={() => setModal("plans")}
        />
      </main>
      <footer className="app-footer">
        <span className={"scan-status " + (status.oiError ? "anomaly" : "")}>
          <i className="dot" />
          {mode === "DEMO"
            ? "模拟数据"
            : status.state === "scanning"
              ? "基线初始化"
              : status.state === "ready"
                ? "实时监听"
                : "连接恢复中"}
          <i>·</i>
          {mode === "LIVE"
            ? `${status.done || 0}/${status.total || "—"} 合约 · ${status.connections || 0}/${status.expectedConnections || "—"} 连接`
            : "12 个标的 · 4 个周期"}
          <i>·</i>
          {mode === "LIVE" ? `页面打开时实时扫描 · 价格 / 成交量 / OI / 新高新低 · 成交额≥${config.minQuoteVolumeM ?? 5}M${config.maxVolumeRank ? ` · K线/OI 前${config.maxVolumeRank}` : " · K线/OI 前80"}` : "45s 刷新"}
        </span>
        <span className="footer-center">
          {counts.unread} 条待处理 · 判断由你完成
        </span>
        <button onClick={() => setModal("shortcuts")}>
          快捷键 <kbd>?</kbd>
        </button>
      </footer>
      {modal === "shortcuts" && (
        <div className="modal-backdrop">
          <section
            className="modal shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">KEYBOARD SHORTCUTS</span>
                <h2 id="shortcuts-title">保持判断的节奏</h2>
              </div>
              <button aria-label="关闭" onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            {[
              ["J", "下一条信号"],
              ["K", "上一条信号"],
              ["W", "加入观察池"],
              ["X", "忽略并继续下一条"],
              ["P", "创建交易计划"],
              ["?", "打开此说明"],
            ].map(([key, label]) => (
              <div className="shortcut-row" key={key}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
            <p className="muted">
              输入框、下拉框和弹窗内不会触发快捷键。Esc 关闭弹窗。
            </p>
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          ✓ {notice}
        </div>
      )}
      {modal === "plan" && (
        <TradePlanModal
          selection={selection}
          onClose={() => setModal(null)}
          onSave={(p) => {
            setPlans((prev) => [p, ...prev]);
            setModal(null);
            setNotice("交易计划已保存");
          }}
        />
      )}
      {modal === "settings" && (
        <Settings
          config={config}
          onClose={() => setModal(null)}
          onSave={(c) => {
            setConfig(c);
            setModal(null);
            setNotice("扫描阈值已更新");
          }}
        />
      )}
      {modal === "plans" && (
        <div className="modal-backdrop">
          <section
            className="modal plans-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plans-title"
          >
            <div className="modal-heading">
              <h2 id="plans-title">
                交易计划 <span>{plans.length}</span>
              </h2>
              <button aria-label="关闭" onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            {!plans.length && (
              <div className="empty">
                尚未创建计划<small>在主图下方点击「创建交易计划」。</small>
              </div>
            )}
            {plans.map((p) => (
              <article className="saved-plan" key={p.id}>
                <h3>
                  {p.symbol} · {p.timeframe}{" "}
                  <span>
                    {p.direction === "long" ? "做多" : "做空"} / 风险{" "}
                    {{ low: "低", medium: "中", high: "高" }[p.riskLevel]}
                  </span>
                </h3>
                <label>入场思路</label>
                <p>{p.entryIdea}</p>
                <label>失效条件</label>
                <p>{p.invalidation}</p>
                {p.note && <p>{p.note}</p>}
                <button
                  onClick={() =>
                    setPlans((prev) => prev.filter((x) => x.id !== p.id))
                  }
                >
                  删除计划
                </button>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
export default function App() {
  // `mode` was originally seeded to DEMO, so old browser storage cannot tell
  // an intentional demo choice from the former default.  Start the updated
  // terminal in LIVE mode once, then retain an explicit v2 preference.
  const modeKey = "mode:v2";
  const [mode, setMode] = useState(() =>
    storage.read(modeKey, "LIVE") === "DEMO" ? "DEMO" : "LIVE",
  );
  return (
    <Desk
      key={mode}
      mode={mode}
      onMode={(m) => {
        storage.write(modeKey, m);
        setMode(m);
      }}
    />
  );
}
