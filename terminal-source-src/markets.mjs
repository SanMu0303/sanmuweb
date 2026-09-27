export const MARKET_LABELS={all:'全部',Crypto:'加密',Stocks:'股票/ETF',Commodities:'大宗商品',TradFi:'其他传统'};
export function contractMarket(s) {
 if(s.contractType!=='TRADIFI_PERPETUAL')return 'Crypto';
 if(s.underlyingType==='COMMODITY')return 'Commodities';
 if(s.underlyingType?.includes('EQUITY'))return 'Stocks';
 return 'TradFi';
}
export function supportedContract(s) {return s.status==='TRADING' && s.quoteAsset==='USDT' && s.marginAsset==='USDT' && ['PERPETUAL','TRADIFI_PERPETUAL'].includes(s.contractType);}
export const CONTRACT_NAMES={XAU:'黄金',XAG:'白银',XPT:'铂金',XPD:'钯金',COPPER:'铜',CL:'WTI 原油',BZ:'布伦特原油',NATGAS:'天然气',TSLA:'特斯拉',NVDA:'英伟达',AAPL:'苹果',MSFT:'微软',AMZN:'亚马逊',GOOGL:'谷歌',SPY:'标普500 ETF',QQQ:'纳斯达克100 ETF'};
