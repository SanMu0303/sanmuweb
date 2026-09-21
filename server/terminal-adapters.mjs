import {createTerminalNews, pageEvents} from './terminal-news.mjs';
import {terminalCapabilities} from './terminal-config.mjs';

export function createSelectedNews({env = process.env, news = createTerminalNews({env}), now = () => new Date().toISOString()} = {}) {
  async function query(config, filters = {}) {
    const capabilities = terminalCapabilities(env);
    const ready = config.sources.filter(source => source.enabled && capabilities[source.kind]);
    const result = await news.query(ready);
    const byId = new Map(config.sources.map(source => [source.id, source]));
    const matched = result.items.filter(item => {
      const source = byId.get(item.sourceId);
      return !source?.keywords.length || source.keywords.some(keyword => `${item.title} ${item.summary}`.toLowerCase().includes(keyword.toLowerCase()));
    });
    const page = pageEvents(matched, filters);
    const resultById = new Map(result.sources.map(source => [source.id, source]));
    return {...result, ...page, sources: config.sources.map(source => resultById.get(source.id) || {id: source.id, name: source.name, status: capabilities[source.kind] ? 'disabled' : 'unconfigured', message: capabilities[source.kind] ? '已停用' : source.kind === 'x' ? 'X 官方数据源尚未配置' : '钱包消息适配器待接入'}), fetchedAt: now()};
  }
  return {query};
}

/** Future adapters must provide verified trade semantics; an unclassified fill stays `trade`.
 * Event contract: {id,accountId,accountName,platform,symbol,direction:'long'|'short'|null,
 * action:'open'|'increase'|'reduce'|'close'|'trade',price,quantity,publishedAt,sourceName,url}.
 * No exchange credentials or trading permissions are requested at this stage.
 */
export function querySmartMoney(config, {now = () => new Date().toISOString()} = {}) {
  return {items: [], nextCursor: null, total: 0, accounts: config.wallets.map(wallet => ({...wallet, status: 'unconfigured'})), sources: [
    {id: 'hyperliquid', name: 'Hyperliquid', status: 'unconfigured', message: '公开账户数据适配器尚未接入'},
    {id: 'binance', name: '币安公开交易员', status: 'unconfigured', message: '仅支持未来接入公开或已授权记录；任意账户交易无法公开查询'},
  ], fetchedAt: now(), pollInterval: 60};
}
