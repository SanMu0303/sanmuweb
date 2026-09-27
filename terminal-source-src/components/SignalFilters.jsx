import { MARKET_LABELS } from "../markets.mjs";
import React from "react";
import { TIMEFRAMES } from "../scanner/config.mjs";
export default function SignalFilters({ filters, onChange }) {
  return (
    <div className="filters">
      <div className="market-tabs">
        <select aria-label="资产分类" value={filters.market || 'all'} onChange={e=>onChange({...filters,market:e.target.value})}>
          {Object.entries(MARKET_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="filter-row">
        <select
          aria-label="周期过滤"
          value={filters.timeframe}
          onChange={(e) => onChange({ ...filters, timeframe: e.target.value })}
        >
          <option value="all">全部周期</option>
          {TIMEFRAMES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="信号过滤"
          value={filters.type}
          onChange={(e) => onChange({ ...filters, type: e.target.value })}
        >
          {[
            ["all", "全部信号"],
            ["extreme", "新高 / 新低"],
            ["volume", "成交量"],
            ["oi", "OI"],
            ["price", "价格异动"],
          ].map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <label className="watch-filter">
        <input
          type="checkbox"
          checked={filters.watched}
          onChange={(e) => onChange({ ...filters, watched: e.target.checked })}
        />
        只看关注标的
      </label>
    </div>
  );
}
