import React,{useEffect,useState} from 'react';
import { MARKET_LABELS } from '../markets.mjs';
import {directBinanceContractsRequest} from '../providers/binance.mjs';
export default function ContractPicker({onSelect,timeframe,mode}) {
 const [items,setItems]=useState([]),[group,setGroup]=useState('Crypto'),[error,setError]=useState('');
 useEffect(()=>{if(mode!=='LIVE')return;let alive=true;fetch('/api/signal-desk/contracts/?source=binance-usdm').then(r=>{if(!r.ok)throw Error();return r.json();}).catch(()=>directBinanceContractsRequest()).then(data=>{if(alive)setItems(data);}).catch(()=>{if(alive)setError('币安合约目录暂不可用');});return()=>{alive=false;};},[mode]);
 if(mode!=='LIVE')return null;
 return <div className="contract-picker">
  <select aria-label="合约目录分类" value={group} onChange={e=>setGroup(e.target.value)}>{Object.entries(MARKET_LABELS).map(([v,n])=><option value={v} key={v}>{n}</option>)}</select>
  <select aria-label="选择币安合约" value="" onChange={e=>{if(e.target.value)onSelect({symbol:e.target.value,timeframe});}}>
   <option value="">{error || (items.length?'选择标的…':'加载合约…')}</option>
   {items.filter(s=>group==='all'||s.market===group).map(s=><option key={s.symbol} value={s.symbol}>{s.symbol} · {s.name}</option>)}
  </select>
 </div>;
}
