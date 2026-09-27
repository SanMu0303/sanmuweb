import { MockProvider } from "./mock.mjs";
import { BinanceProvider } from "./binance.mjs";
export const providers = {
  DEMO: new MockProvider(),
  LIVE: new BinanceProvider(),
};
