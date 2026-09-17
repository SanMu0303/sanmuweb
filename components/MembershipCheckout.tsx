"use client";

import {useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,ArrowRight,Check,ChevronDown,Wallet,X} from 'lucide-react';
import styles from './membership-checkout.module.css';

type PaymentMethod='wechat'|'alipay'|'usdt'|'usdc';
type Network={id:string;label:string};
const methods:Record<PaymentMethod,{label:string;currency:string;amount:number}>={
 wechat:{label:'微信',currency:'CNY',amount:3500},
 alipay:{label:'支付宝',currency:'CNY',amount:3500},
 usdt:{label:'USDT',currency:'USDT',amount:500},
 usdc:{label:'USDC',currency:'USDC',amount:500},
};
const networks:Record<'usdt'|'usdc',Network[]>={
 usdt:[{id:'tron',label:'TRON（TRX / TRC20）'},{id:'bsc',label:'BNB Smart Chain（BSC / 映射版）'},{id:'solana',label:'Solana（SOL）'},{id:'ethereum',label:'Ethereum（ETH / ERC20）'}],
 usdc:[{id:'solana',label:'Solana（SOL）'},{id:'ethereum',label:'Ethereum（ETH / ERC20）'},{id:'base',label:'Base'},{id:'arbitrum',label:'Arbitrum One'},{id:'polygon',label:'Polygon PoS'}],
};

export default function MembershipCheckout(){
 const [method,setMethod]=useState<PaymentMethod>('wechat');
 const [network,setNetwork]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 const confirmButton=useRef<HTMLButtonElement>(null);
 const crypto=method==='usdt'||method==='usdc';
 const options=crypto?networks[method]:[];
 const selectedNetwork=options.find(item=>item.id===network);
 const payment=methods[method];
 const amount=payment.amount.toLocaleString('en-US');

 function confirm(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(crypto&&!selectedNetwork)return;
  dialog.current?.showModal();
 }
 function close(){dialog.current?.close()}

 return <div className={styles.page}>
  <Link className={styles.back} href="/membership/"><ArrowLeft size={15}/>返回会员中心</Link>
  <header className={styles.heading}>
   <span className="eyebrow">MEMBERSHIP</span>
   <h1>开通会员</h1>
   <p>一年的研究与积累，随时回看。</p>
  </header>
  <form onSubmit={confirm} className={styles.form}>
   <div className={styles.grid}>
    <section className={styles.selections} aria-label="会员开通选项">
     <div className={styles.section}>
      <h2><span className={styles.step}>01</span>支付方式</h2>
      <label className={styles.field} htmlFor="membership-payment-method">选择支付方式</label>
      <div className={styles.selectWrap}>
       <select id="membership-payment-method" name="paymentMethod" value={method} onChange={event=>{setMethod(event.target.value as PaymentMethod);setNetwork('')}}>
        {Object.entries(methods).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}
       </select><ChevronDown size={17} aria-hidden="true"/>
      </div>
      {crypto&&<div className={styles.networkField}>
       <label className={styles.field} htmlFor="membership-payment-network">选择公链</label>
       <div className={styles.selectWrap}>
        <select id="membership-payment-network" name="network" value={network} required onChange={event=>setNetwork(event.target.value)}>
         <option value="" disabled>请选择 {payment.label} 公链</option>
         {options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
        </select><ChevronDown size={17} aria-hidden="true"/>
       </div>
       <p className={styles.hint}>不同币种的可选公链不同，支付时需与收款网络一致。</p>
      </div>}
     </div>
     <fieldset className={styles.duration}>
      <legend><span className={styles.step}>02</span>会员时长</legend>
      <label className={styles.plan}>
       <input type="radio" name="duration" value="365" checked readOnly/>
       <span className={styles.planText}><strong>365 天</strong><small>年度会员</small></span>
       <span className={styles.planCheck} aria-hidden="true"><Check size={16}/></span>
      </label>
      <p className={styles.hint}>一次开通，有效期 365 天。</p>
     </fieldset>
    </section>
    <aside className={styles.summary} aria-label="开通信息">
     <span className={styles.summaryEyebrow}>年度会员</span>
     <h2>让研究持续积累</h2>
     <ul className={styles.benefits}>
      <li><Check size={15}/>完整会员研究与市场复盘</li>
      <li><Check size={15}/>会员视频与课程内容</li>
      <li><Check size={15}/>趋势观察与方法案例回看</li>
     </ul>
     <dl className={styles.details}>
      <div><dt>支付方式</dt><dd>{payment.label}</dd></div>
      {crypto&&<div><dt>公链</dt><dd>{selectedNetwork?.label||'待选择'}</dd></div>}
      <div><dt>会员时长</dt><dd>365 天</dd></div>
     </dl>
     <div className={styles.total} aria-live="polite" aria-atomic="true">
      <span>支付金额</span><p><strong>{crypto?'':'¥'}{amount}</strong><span>{payment.currency}</span></p>
     </div>
    </aside>
   </div>
   <div className={styles.footer}>
    <p>收款信息准备中，暂未开放付款。</p>
    <button ref={confirmButton} type="submit" className={styles.confirm}>确认支付<ArrowRight size={18}/></button>
   </div>
  </form>

  <dialog ref={dialog} className={styles.dialog} aria-labelledby="membership-payment-title" aria-describedby="membership-payment-description" onClose={()=>confirmButton.current?.focus()}>
   <div className={styles.dialogContent}>
    <button type="button" className={styles.close} aria-label="关闭支付窗口" onClick={close}><X size={21}/></button>
    <span className={styles.summaryEyebrow}>会员支付</span>
    <h2 id="membership-payment-title">{payment.label}支付</h2>
    <p className={styles.dialogAmount}><strong>{crypto?'':'¥'}{amount}</strong><span>{payment.currency}</span></p>
    <dl className={styles.details}>
     <div><dt>会员时长</dt><dd>365 天</dd></div>
     <div><dt>支付方式</dt><dd>{payment.label}</dd></div>
     {crypto&&<div><dt>公链</dt><dd>{selectedNetwork?.label}</dd></div>}
    </dl>
    <div className={styles.unavailable}>
     <span className={styles.walletIcon}><Wallet size={26}/></span>
     <h3>收款信息准备中</h3>
     <p id="membership-payment-description">暂未开放付款，当前不会扣款或开通会员。<br/>请稍后再来。</p>
    </div>
    <button className={styles.returnButton} type="button" onClick={close}>返回修改</button>
   </div>
  </dialog>
 </div>;
}
