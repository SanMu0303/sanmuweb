import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../server/supabase/api.mjs';

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_EMAILS:'owner@example.com'};
const future='2099-12-31T00:00:00.000Z';
const past='2020-01-01T00:00:00.000Z';
const identities={
  guest:{signedIn:false,isAdmin:false},
  ordinary:{id:'ordinary',signedIn:true,isAdmin:false},
  expired:{id:'expired',signedIn:true,isAdmin:false},
  member:{id:'member',signedIn:true,isAdmin:false},
};
const memberships={
  ordinary:{status:'none',expiresAt:null,revision:1},
  expired:{status:'expired',expiresAt:past,revision:2},
  member:{status:'active',expiresAt:future,revision:3},
};

function buildApi(actor,repo){
  return createApi({env,repo,auth:{identify:async()=>identities[actor],requireRecent:async()=>{}},memberships:{get:async id=>memberships[id]||{status:'none',expiresAt:null,revision:0}}});
}
function getRequest(path){return new Request(`https://site.test${path}`);}

const sensitivePost={
  slug:'member-execution',title:'会员执行记录',excerpt:'公开摘要',publishedAt:'2026-09-19',
  sections:[{heading:'公开预览',text:'安全摘要'},{heading:'执行条件',text:'SECRET_ENTRY_81000 STOP_79000 POSITION_20_PERCENT'}],
  access:'member',status:'published',images:[],tags:['执行层'],format:'short',symbol:'BTC',market:'加密',trendStage:'运行',
};

test('member short posts are projected by server for guest, ordinary and expired users',async()=>{
  const repo={list:async table=>table==='videos'?[]:[sensitivePost],get:async()=>sensitivePost};
  for(const actor of ['guest','ordinary','expired']){
    const api=buildApi(actor,repo);
    for(const path of ['/api/feed','/api/posts','/api/posts/member-execution','/api/articles/member-execution']){
      const response=await api(getRequest(path));
      assert.equal(response.status,200,`${actor} ${path}`);
      const body=await response.text();
      assert.equal(body.includes('SECRET_ENTRY_81000'),false,`${actor} leaked full execution body from ${path}`);
      assert.equal(body.includes('STOP_79000'),false,`${actor} leaked risk condition from ${path}`);
      assert.equal(body.includes('POSITION_20_PERCENT'),false,`${actor} leaked position guidance from ${path}`);
      assert.match(body,/locked|会员|公开摘要|安全摘要/,'response should retain a safe preview or membership marker');
    }
  }
});

test('legacy excerpts are never reused as member execution previews',async()=>{
  const legacy={...sensitivePost,slug:'legacy-excerpt',title:'BTC81000做多',symbol:'BTC81000做多',statusText:'止损79000',sector:'BTC 做多 81000',timeframe:'止损79000',tags:['仓位20%','执行层'],excerpt:'BTC81000做多，止损79000，仓位20%',sections:[{heading:'',text:'BTC81000做多，止损79000，仓位20%'}]};
  const repo={list:async table=>table==='videos'?[]:[legacy],get:async()=>legacy};
  const body=await (await buildApi('guest',repo)(getRequest('/api/posts/legacy-excerpt'))).json();
  assert.equal(body.locked,true);
  assert.equal(body.content.length,0);
  assert.equal(body.summary,'');
  assert.equal(JSON.stringify(body).includes('81000'),false);
  assert.equal(JSON.stringify(body).includes('止损'),false);
  assert.equal(body.title,'会员研究记录');
  assert.equal(body.symbol,'');
  assert.equal(body.sector,'');
  assert.equal(body.timeframe,'');
  const searched=await (await buildApi('guest',repo)(getRequest('/api/feed?q=81000'))).json();
  assert.deepEqual(searched,[]);
});

test('active observation details hide thesis, invalidation and update history from non-members',async()=>{
  const active={id:'active-btc',symbol:'BTC',name:'BTC81000做多',market:'加密',stage:'运行',observationStatus:'active',createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-19T00:00:00.000Z',thesis:'SECRET_THESIS_ENTRY_81000',invalidation:'SECRET_INVALIDATION_STOP_79000',publicSummary:'BTC entry 81000',summary:'安全观察摘要',images:[]};
  const history=[{revision:1,recorded_at:'2026-09-01T00:00:00.000Z',document:{...active,thesis:'SECRET_HISTORY_ENTRY',invalidation:'SECRET_HISTORY_STOP'}}];
  const repo={list:async()=>[active],get:async(_table,key)=>key==='BTC'||key==='active-btc'?active:null,history:async()=>history};
  for(const actor of ['guest','ordinary','expired']){
    const api=buildApi(actor,repo);
    const list=await api(getRequest('/api/watchlist'));
    assert.equal(list.status,200);
    const listBody=await list.text();
    assert.equal(listBody.includes('SECRET_THESIS_ENTRY_81000'),false,`${actor} watchlist leaked thesis`);
    assert.equal(listBody.includes('SECRET_INVALIDATION_STOP_79000'),false,`${actor} watchlist leaked invalidation`);
    const detail=await api(getRequest('/api/watchlist/BTC'));
    assert.equal(detail.status,200);
    const detailBody=await detail.text();
    const historyResponse=await api(getRequest('/api/watchlist/BTC/history'));
    assert.equal(historyResponse.status,200);
    const historyBody=await historyResponse.text();
    assert.equal(detailBody.includes('SECRET_THESIS_ENTRY_81000'),false,`${actor} detail leaked thesis`);
    assert.equal(detailBody.includes('SECRET_HISTORY_ENTRY'),false,`${actor} history leaked update`);
    assert.equal(historyBody.includes('SECRET_HISTORY_ENTRY'),false,`${actor} direct history leaked update`);
    assert.match(detailBody,/active|正在观察|会员/,'active detail should retain status and access prompt');
    assert.equal(detailBody.includes('BTC81000做多'),false);
    assert.equal(detailBody.includes('BTC entry 81000'),false);
  }
  const memberList=await apiForMember(repo,'member','/api/watchlist');
  const memberListBody=await memberList.text();
  assert.equal(memberListBody.includes('SECRET_THESIS_ENTRY_81000'),true);
  const memberDetail=await apiForMember(repo,'member','/api/watchlist/BTC');
  const memberBody=await memberDetail.text();
  assert.equal(memberBody.includes('SECRET_THESIS_ENTRY_81000'),true);
  assert.equal(memberBody.includes('SECRET_HISTORY_ENTRY'),true);
});

async function apiForMember(repo,actor,path){return buildApi(actor,repo)(getRequest(path));}

test('ended observation is readable in full by every audience, including guests',async()=>{
  const ended={id:'ended-btc',symbol:'BTC',name:'比特币',market:'加密',stage:'失效',observationStatus:'ended',endedAt:'2026-09-18T00:00:00.000Z',createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-18T00:00:00.000Z',thesis:'ENDED_THESIS_FULL_TEXT',invalidation:'ENDED_INVALIDATION_FULL_TEXT',summary:'历史观察摘要',images:[]};
  const history=[{revision:1,recorded_at:'2026-09-01T00:00:00.000Z',document:{...ended,thesis:'ENDED_HISTORY_FULL_TEXT'}}];
  const repo={list:async()=>[ended],get:async(_table,key)=>key==='BTC'||key==='ended-btc'?ended:null,history:async()=>history};
  for(const actor of ['guest','ordinary','expired','member']){
    const detail=await apiForMember(repo,actor,'/api/watchlist/BTC');
    assert.equal(detail.status,200,actor);
    const body=await detail.text();
    const historyResponse=await apiForMember(repo,actor,'/api/watchlist/BTC/history');
    assert.equal(historyResponse.status,200,actor);
    const historyBody=await historyResponse.text();
    assert.equal(body.includes('ENDED_THESIS_FULL_TEXT'),true,`${actor} should read ended thesis`);
    assert.equal(body.includes('ENDED_INVALIDATION_FULL_TEXT'),true,`${actor} should read ended invalidation`);
    assert.equal(body.includes('ENDED_HISTORY_FULL_TEXT'),true,`${actor} should read ended history`);
    assert.equal(historyBody.includes('ENDED_HISTORY_FULL_TEXT'),true,`${actor} should read ended history endpoint`);
  }
});
