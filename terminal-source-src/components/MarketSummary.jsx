import React,{useEffect,useState} from 'react';
import {directBinanceMarketSummary} from '../providers/binance.mjs';
const compact = n => n==null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
const price = n => n==null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US',{maximumFractionDigits:n<1?6:2}).format(n);
const rate = n => n==null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(4)}%`;
export default function MarketSummary({symbol,mode}) {
 const [result,setResult]=useState(null),[error,setError]=useState('');
 useEffect(()=>{
  let alive=true,busy=false;const controller=new AbortController();setResult(null);setError('');
  async function load(){
   if(busy || mode!=='LIVE')return;busy=true;
   try{
    let data;
    try{
     const r=await fetch('/api/signal-desk/market-summary/?'+new URLSearchParams({symbol,source:'binance-usdm'}),{signal:controller.signal});
     if(!r.ok)throw Error();
     data=await r.json();
    }catch{data=await directBinanceMarketSummary(symbol);}
    if(alive){setResult(data);setError('');}
   }catch(e){if(alive)setError(e.message);}finally{busy=false;}
  }
  void load();const timer=setInterval(load,30000);return()=>{alive=false;controller.abort();clearInterval(timer);};
 },[symbol,mode]);
 const d=result?.symbol===symbol?result:null;
 const suffix=mode==='DEMO'?'DEMO · 切换 LIVE 查看真实概览':error?'更新失败':!d?'加载中…':d.error || (d.source==='browser-direct'?'币安公共接口直连 · 30s 更新':'30s 更新 · 当前行情');
 return <div className="market-summary" aria-label="标的行情概览" title={suffix}>
  <span title={`币安 USDT 永续 24 小时成交额；成交数量 ${compact(d?.baseVolume)} ${d?.base || ''}${d?.error?' · '+d.error:''}`}><small>24H 成交额</small><b>{compact(d?.volume)} <em>USDT</em></b></span>
  <span title={`持仓名义价值 = ${compact(d?.openInterest)} ${d?.base || ""} × 标记价格 ${d?.markPrice ?? "—"} USDT${d?.oiTime?' · '+new Date(d.oiTime).toLocaleString('zh-CN'):''}${d?.oiError?' · '+d.oiError:''}`}><small>持仓量</small><b>{compact(d?.openInterestUSDT)} <em>USDT</em></b></span>
  <span title="币安合约标记价格"><small>标记价格</small><b>{price(d?.markPrice)} <em>USDT</em></b></span>
  <span title={`按币安 USDT 永续合约 24 小时成交额排名 · 共 ${d?.total || '—'} 个合约`}><small>24H 成交排名</small><b>{d?.rank ? '#'+d.rank : '—'}</b></span>
  <span title={d?.nextFundingTime?`下一次资金费率结算：${new Date(d.nextFundingTime).toLocaleString('zh-CN')}`:'币安最近资金费率'}><small>资金费率</small><b className={d?.fundingRate==null?'':d.fundingRate>=0?'metric-up':'metric-down'}>{rate(d?.fundingRate)}</b></span>
  <small className="metric-status">{suffix}</small>
 </div>;
}
