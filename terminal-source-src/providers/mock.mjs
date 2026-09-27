import { SECONDS } from "../scanner/config.mjs";
export const DEMO_SYMBOLS = [
  "DOGEUSDT",
  "WIFUSDT",
  "SOLUSDT",
  "BTCUSDT",
  "ETHUSDT",
  "SUIUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "NEARUSDT",
  "ARBUSDT",
  "APTUSDT",
  "XRPUSDT",
];
const bases = [
  0.1084, 0.72, 148.2, 63480, 2640, 1.42, 14.3, 27.4, 4.8, 0.61, 7.9, 0.58,
];
export class MockProvider {
  async getUniverse() {
    return DEMO_SYMBOLS;
  }
  async getKlines(symbol, timeframe, at) {
    let seed = [...symbol].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const step = SECONDS[timeframe],
      end = Math.floor(Date.now() / 1000 / step) * step,
      base = bases[DEMO_SYMBOLS.indexOf(symbol)] || 100;
    let price = base * 0.86;
    return Array.from({ length: 240 }, (_, i) => {
      const open = price;
      price =
        i > 158 && i < 233
          ? base * (0.975 + Math.sin(i * 0.55) * 0.008 + (rand() - 0.5) * 0.007)
          : open * (1 + (rand() - 0.44) * 0.017);
      if (i >= 233) price = base * (1 + (i - 232) * 0.007);
      return {
        time: end - (239 - i) * step,
        open,
        close: price,
        high: Math.max(open, price) * (1 + rand() * 0.006),
        low: Math.min(open, price) * (1 - rand() * 0.006),
        volume: (15 + rand() * 28) * 1e5 * (i === 234 ? 3.8 : 1),
      };
    });
  }
  async getVolume(s, t) {
    return (await this.getKlines(s, t)).map(({ time, volume }) => ({
      time,
      volume,
    }));
  }
  async getOIHistory(symbol, timeframe, at) {
    const bars = await this.getKlines(symbol,timeframe,at);
    return bars.map((b,i) => ({time:b.time,value:100000*(1+Math.sin(i/18)*0.08+i/1500)}));
  }
  async getOI() {
    const t = Math.floor(Date.now() / 3600000) * 3600;
    return Array.from({ length: 6 }, (_, i) => ({
      time: t - (5 - i) * 3600,
      value: 100000 * (i === 5 ? 1.184 : 1),
    }));
  }
  async getTickers() {
    return [];
  }
  async getSignals() {
    const types = [
      "breakout",
      "oi",
      "extreme",
      "volume",
      "price",
      "extreme",
      "breakout",
      "volume",
      "price",
      "extreme",
      "oi",
      "breakout",
    ];
    const signals = await Promise.all(
      DEMO_SYMBOLS.map(async (symbol, i) => {
        const timeframe = ["1H", "4H", "1H", "15m", "4H", "1D"][i % 6],
          bars = await this.getKlines(symbol, timeframe),
          b = bars.at(-6 - (i % 3)),
          type = types[i],
          title = {
            breakout: "横盘突破",
            oi: "OI持仓量异常",
            extreme: i === 9 ? "20周期新低" : "60周期新高",
            volume: "成交量异常",
            price: "大幅价格异动",
          }[type],
          value = {
            breakout: "60K · 区间 4.2%",
            oi: "OI 1H +18.4%",
            extreme: `收盘 ${b.close.toPrecision(5)}`,
            volume: "Volume 3.2x",
            price: "4H +13.2%",
          }[type];
        return {
          id: `demo:${symbol}:${b.time}`,
          symbol,
          market: "Crypto",
          timeframe,
          type,
          title,
          value,
          description: title + " · " + value,
          triggeredAt: b.time,
          triggerPrice: b.close,
          source: "demo",
          metadata: { demo: true },
        };
      }),
    );
    // Two additional DEMO occurrences illustrate cooldown merging without inventing a LIVE signal.
    const repeated = signals.find((s) => s.symbol === "BTCUSDT");
    const repeatBars = await this.getKlines(
      repeated.symbol,
      repeated.timeframe,
    );
    for (const offset of [7, 8]) {
      const bar = repeatBars.at(-offset);
      signals.push({
        ...repeated,
        id: `demo:${repeated.symbol}:${bar.time}`,
        triggeredAt: bar.time,
        triggerPrice: bar.close,
      });
    }
    return {
      signals,
      status: {
        state: "demo",
        done: 12,
        total: 12,
        updatedAt: Date.now(),
        message: "演示数据 · 不代表真实市场",
      },
    };
  }
}
export const demoWatchlist = [
  {
    symbol: "SOLUSDT",
    market: "Crypto",
    timeframe: "4H",
    stage: "launch",
    waitingFor: "第一次分歧后企稳",
    note: "观察回踩时的量能变化",
    addedAt: Date.now(),
  },
  {
    symbol: "BTCUSDT",
    market: "Crypto",
    timeframe: "1D",
    stage: "preparation",
    waitingFor: "区间上沿有效突破",
    note: "等待收盘确认",
    addedAt: Date.now(),
  },
];
