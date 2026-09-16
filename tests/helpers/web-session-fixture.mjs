import {createHash} from 'node:crypto';

// Deliberately unsigned fixtures: Auth identity is supplied by each test's /user mock.
export const opaqueToken='1'.repeat(64);
export const authSessionId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const hashToken=token=>createHash('sha256').update(token).digest('hex');
export function authSession(userId){
 const payload=Buffer.from(JSON.stringify({sub:userId,session_id:authSessionId})).toString('base64url');
 return {access_token:'fixture.'+payload+'.unsigned',refresh_token:'fixture-private-refresh',expires_in:7200};
}
export function webSessionFixture(userId,{epoch=7,events=[]}={}){
 const tokens=authSession(userId),calls=[];
 const rows=new Map([[hashToken(opaqueToken),{state:'ready',user_id:userId,auth_session_id:authSessionId,access_token:tokens.access_token,refresh_token:tokens.refresh_token,version:1,reauthenticated_at:null}]]);
 const record=(method,args)=>{calls.push({method,args});events.push('sessions.'+method)};
 const sessions={
  async begin(email){record('begin',[email]);return {user_id:userId,epoch}},
  async create(hash,id,sessionId,tokenValues,expectedEpoch){record('create',[hash,id,sessionId,tokenValues,expectedEpoch]);rows.set(hash,{state:'ready',user_id:id,auth_session_id:sessionId,access_token:tokenValues.token,refresh_token:tokenValues.refreshToken,version:1,reauthenticated_at:null});return true},
  async resolve(hash,owner){record('resolve',[hash,owner]);return rows.get(hash)||{state:'missing'}},
  async finish(hash,owner,version,next){record('finish',[hash,owner,version,next]);const row=rows.get(hash);if(!row)return false;rows.set(hash,{...row,access_token:next.token,refresh_token:next.refreshToken,version:version+1});return true},
  async release(...args){record('release',args);return true},
  async revoke(hash){record('revoke',[hash]);rows.delete(hash);return true},
  async revokeAll(id){record('revokeAll',[id]);for(const [hash,row] of rows)if(row.user_id===id)rows.delete(hash);return true},
  async reauthenticate(hash,id){record('reauthenticate',[hash,id]);const row=rows.get(hash);if(!row||row.user_id!==id)return false;row.reauthenticated_at=new Date().toISOString();return true},
 };
 return {sessions,calls,events,tokens,epoch,cookie:'research_session='+opaqueToken};
}
