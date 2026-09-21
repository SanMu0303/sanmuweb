export type TerminalPanelId = "chart" | "market" | "selected" | "smart";

export type TerminalSourceKind = "rss" | "x";

export interface TerminalSource {
  id: string;
  kind: TerminalSourceKind;
  name: string;
  address: string;
  enabled: boolean;
}

export interface TrackedWallet {
  id: string;
  platform: "hyperliquid" | "binance";
  name: string;
  address: string;
}

export interface TerminalPreferences {
  version: 1;
  order: TerminalPanelId[];
  chartHeight: number;
  symbol: string;
  interval: string;
  sources: TerminalSource[];
  wallets: TrackedWallet[];
}

export const TERMINAL_STORAGE_KEY = "sanmu-terminal-preferences-v1";

export const TERMINAL_DEFAULTS: TerminalPreferences = {
  version: 1,
  order: ["chart", "market", "selected", "smart"],
  chartHeight: 510,
  symbol: "BINANCE:BTCUSDT",
  interval: "60",
  sources: [],
  wallets: [],
};

const validPanels = new Set<TerminalPanelId>(TERMINAL_DEFAULTS.order);
const validIntervals = new Set(["1", "3", "5", "15", "30", "60", "240", "D", "W"]);

function text(value: unknown, max: number) {
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

function uniquePanels(value: unknown): TerminalPanelId[] {
  const result: TerminalPanelId[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && validPanels.has(item as TerminalPanelId) && !result.includes(item as TerminalPanelId)) {
        result.push(item as TerminalPanelId);
      }
    }
  }
  for (const panel of TERMINAL_DEFAULTS.order) if (!result.includes(panel)) result.push(panel);
  return result;
}

export function sanitizeTerminalPreferences(value: unknown): TerminalPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const symbol = text(input.symbol, 64).toUpperCase();
  const interval = text(input.interval, 8).toUpperCase();
  const sources = Array.isArray(input.sources) ? input.sources.slice(0, 8).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const kind = source.kind === "x" ? "x" : source.kind === "rss" ? "rss" : null;
    const address = text(source.address, 512);
    if (!kind || !address) return [];
    return [{
      id: text(source.id, 48) || `source-${index + 1}`,
      kind,
      name: text(source.name, 80) || "自选来源",
      address,
      enabled: source.enabled !== false,
    } satisfies TerminalSource];
  }) : [];
  const wallets = Array.isArray(input.wallets) ? input.wallets.slice(0, 12).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const wallet = item as Record<string, unknown>;
    const platform = wallet.platform === "binance" ? "binance" : wallet.platform === "hyperliquid" ? "hyperliquid" : null;
    const address = text(wallet.address, 160);
    if (!platform || !address) return [];
    return [{id: text(wallet.id, 48) || `wallet-${index + 1}`, platform, name: text(wallet.name, 80) || "未命名账户", address} satisfies TrackedWallet];
  }) : [];
  return {
    version: 1,
    order: uniquePanels(input.order),
    chartHeight: Math.min(760, Math.max(360, Number(input.chartHeight) || TERMINAL_DEFAULTS.chartHeight)),
    symbol: symbol || TERMINAL_DEFAULTS.symbol,
    interval: validIntervals.has(interval) ? interval : TERMINAL_DEFAULTS.interval,
    sources,
    wallets,
  };
}

export function moveTerminalPanel(order: TerminalPanelId[], from: number, to: number) {
  const next = uniquePanels(order);
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [panel] = next.splice(from, 1);
  next.splice(to, 0, panel);
  return next;
}

export function normalizeTerminalSource(input: {kind: TerminalSourceKind; name?: string; address: string}): TerminalSource | null {
  const address = text(input.address, 512);
  if (input.kind === "x") {
    if (!/^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?@?[A-Za-z0-9_]{1,15}$/.test(address)) return null;
  } else {
    try {
      const url = new URL(address);
      if (url.protocol !== "https:" || url.username || url.password || url.hash || !url.hostname) return null;
      if (/^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|\[?::1\]?)/i.test(url.hostname)) return null;
    } catch { return null; }
  }
  const id = `${input.kind}-${address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 38) || "source"}`;
  return {id, kind: input.kind, name: text(input.name, 80) || (input.kind === "x" ? "X 账号" : "RSS 来源"), address, enabled: true};
}

export function addTerminalSource(list: TerminalSource[], source: TerminalSource) {
  if (list.some(item => item.kind === source.kind && item.address.toLowerCase() === source.address.toLowerCase())) return list;
  return [...list, source].slice(0, 8);
}

export function collectNewNewsIds(previous: Set<string>, items: Array<{id: string}>) {
  return items.filter(item => item.id && !previous.has(item.id)).map(item => item.id);
}
