export type Timeframe = "15m" | "1H" | "4H" | "1D";
export type SignalType =
  "extreme" | "volume" | "oi" | "breakout" | "price" | "system";
export type SignalStatus = "unread" | "viewed" | "watchlist" | "ignored";
export type Stage = "preparation" | "launch" | "trend" | "climax" | "reversal";
export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export type SignalPriority = "low" | "normal" | "high" | "system";
export interface Signal {
  priority?: SignalPriority;
  status?: SignalStatus;
  triggerCount?: number;
  firstTriggeredAt?: number;
  eventIds?: string[];
  triggerTimes?: number[];
  id: string;
  symbol: string;
  market: "Crypto";
  timeframe: Timeframe;
  type: SignalType;
  title: string;
  description: string;
  value: string;
  triggeredAt: number;
  triggerPrice: number;
  metadata: Record<string, unknown>;
  source: "demo" | "binance" | "binance-usdm";
}
export interface CustomSignal extends Signal {
  type: "system";
  metadata: {
    systemType:
      | "launch"
      | "first_divergence"
      | "2B"
      | "continuation"
      | "third_leg"
      | "invalidated";
  };
}
export interface KlineProvider {
  getKlines(
    symbol: string,
    timeframe: Timeframe,
    at?: number,
  ): Promise<Kline[]>;
}
export interface VolumeProvider {
  getVolume(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<{ time: number; volume: number }[]>;
}
export interface OIProvider {
  getOI(symbol: string): Promise<{ time: number; value: number }[]>;
}
export interface MarketDataProvider
  extends KlineProvider, VolumeProvider, OIProvider {
  getUniverse(): Promise<string[]>;
  getTickers(): Promise<unknown[]>;
}
export interface SignalProvider {
  getSignals(): Promise<{ signals: Signal[]; status: Record<string, unknown> }>;
}
export interface WatchItem {
  symbol: string;
  market: "Crypto";
  timeframe: Timeframe;
  stage: Stage;
  waitingFor: string;
  note: string;
  addedAt: number;
}
export interface StorageAdapter {
  read<T>(key: string, fallback: T): T;
  write(key: string, value: unknown): boolean;
}
