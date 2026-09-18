import {createProfile} from './profile.mjs';
import {createVideos} from './videos.mjs';
import {createVideoCovers} from './video-covers.mjs';
import {createImages} from './images.mjs';
import {createRepository} from './repository.mjs';
import {createAuth,sessionCookie} from './auth.mjs';
import {createMemberships} from './memberships.mjs';
import {canReadMemberContent,emptyMembership} from '../member-access.mjs';
import {checkMutation,publicOrigin} from './request-security.mjs';
import {article,watch,watchSync} from '../content-validation.mjs';
import {projectPost,toArticleDocument,filterPosts,orderPosts} from '../post-model.mjs';
import {projectVideo,videoPost} from '../video-model.mjs';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
async function body(request){if(Number(request.headers.get('content-length'))>250000)fail('内容过大',413);const raw=await request.text();if(raw.length>250000)fail('内容过大',413);try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))fail('内容格式不正确');return value}catch{fail('内容格式不正确')}}
/** @param {{env?: NodeJS.ProcessEnv, repo?: ReturnType<typeof createRepository>, auth?: ReturnType<typeof createAuth>, memberships?: ReturnType<typeof createMemberships>, videos?: object[], courses?: object[]}} options */
export function createApi({env=process.env,repo=createRepository(),auth=createAuth(env),memberships,videos=[],courses=[]}={}){
 const memberService=()=>memberships||(memberships=createMemberships(env));
 async function withMembership(user){
  const membership=user.signedIn?await memberService().get(user.id):emptyMembership();
  const current={...user,membership,isMember:false};
  current.isMember=!!(user.signedIn&&membership.status==='active'&&Date.parse(membership.expiresAt)>Date.now());
  return current;
 }
 function readerPost(article,user){
  const post=projectPost(article,canReadMemberContent(user));
  post.images=post.images.map(({storagePath,...image})=>image);
  return post;
 }
 const handle=async request=>{
  try{
   const url=new URL(request.url),path=url.pathname.replace(/\/$/,''),method=request.method;
   if(!['GET','HEAD'].includes(method)){
    const check=checkMutation(request,env);
    if(!check.ok){console.warn('Request rejected',{path,status:403,reason:check.reason,origin:request.headers.get('origin'),expected:check.expected,contentType:request.headers.get('content-type')});return json({error:check.reason==='origin'?'请求来源不正确，请从当前网站重新打开登录页':'请求内容类型不正确，请使用 JSON'},403)}
   }
   if(path==='/api/auth/login'&&method==='POST'){const input=await body(request),session=await auth.login(input.email,input.password);return json(await withMembership(session.user),200,{'Set-Cookie':sessionCookie(session.token,session.expires,publicOrigin(request,env).startsWith('https:'))})}
   if(path==='/api/auth/register/send'&&method==='POST'){const input=await body(request);return json(await auth.sendRegistration(input.email,input.password))}
   if(path==='/api/auth/register'&&method==='POST'){const input=await body(request),session=await auth.register(input.email,input.password,input.code);return json(await withMembership(session.user),200,{'Set-Cookie':sessionCookie(session.token,session.expires,publicOrigin(request,env).startsWith('https:'))})}
   if(path==='/api/auth/password/send'&&method==='POST'){const input=await body(request);return json(await auth.sendPasswordReset(input.email))}
   if(path==='/api/auth/password/reset'&&method==='POST'){const input=await body(request);return json(await auth.resetPassword(input.email,input.password,input.code),200,{'Set-Cookie':sessionCookie('',0,publicOrigin(request,env).startsWith('https:'))})}
   if(['/api/auth/otp/send','/api/auth/otp/verify'].includes(path)&&method==='POST')return json({error:'已改为邮箱密码登录，请刷新页面。未设置密码可点击忘记密码。'},410);
   if(path==='/api/auth/logout'&&method==='POST'){await auth.logout(request);return json({signedOut:true},200,{'Set-Cookie':sessionCookie('',0,publicOrigin(request,env).startsWith('https:'))})}
   if(path==='/api/auth/logout-all'&&method==='POST'){await auth.logout(request,true);return json({signedOut:true},200,{'Set-Cookie':sessionCookie('',0,publicOrigin(request,env).startsWith('https:'))})}
   if(path==='/api/auth/reauth'&&method==='POST'){const input=await body(request);return json(await auth.reauthenticate(request,input.password))}
   const identity=await auth.identify(request);
   if(path.startsWith('/api/admin/')&&!identity.isAdmin)return json({error:identity.signedIn?'当前账号没有管理权限':'请先登录管理员账号'},identity.signedIn?403:401);
   if(path.startsWith('/api/admin/')&&!['GET','HEAD'].includes(method))await auth.requireRecent(request);
   if(path==='/api/admin/members'&&method==='GET')return json(await memberService().list({query:url.searchParams.get('q')||'',page:url.searchParams.has('page')?Number(url.searchParams.get('page')):1,status:url.searchParams.get('status')||'all'}));
   if(/^\/api\/admin\/members\/[^/]+$/.test(path)&&method==='PUT')return json(await memberService().save(identity,decodeURIComponent(path.split('/')[4]),await body(request)));
   const user=await withMembership(identity);
   if(path==='/api/session'&&method==='GET')return json({...user,configured:!!env.ADMIN_EMAILS});
   if(path==='/api/profile'||path==='/api/profile/avatar'){if(!user.signedIn)return json({error:'请先登录'},401);if(path.endsWith('/avatar')&&method==='GET')return await createProfile().avatar(request,auth);if(path==='/api/profile'&&method==='GET')return json(user);if(path==='/api/profile'&&method==='PUT')return json(await createProfile().save(request,await body(request),auth));}
   if(path.startsWith('/api/images/')||path.startsWith('/api/admin/images'))return await createImages().handle(request,user,repo);
   if(path.startsWith('/api/video-covers/')||path==='/api/admin/video-covers'||path.startsWith('/api/admin/video-covers/'))return await createVideoCovers().handle(request,user,repo);
   if(path.startsWith('/api/video-files/')||path==='/api/admin/videos'||path==='/api/admin/video-uploads')return await createVideos(undefined,undefined,videos).handle(request,user,repo);
   const libraryVideos=async()=>{const saved=await repo.list('videos');return [...saved.filter(v=>v.status==='published'&&!v.deletedAt),...videos.filter(v=>!saved.some(s=>s.id===v.id))]};
   if(path==='/api/library'&&method==='GET'){const visible=await libraryVideos();const ids=new Set(visible.map(v=>v.id));const visibleCourses=courses.map(c=>{const chapters=(c.chapters||[]).map(ch=>({...ch,lessons:ch.lessons.filter(l=>l.contentType!=='video'||ids.has(l.contentId))}));return {...c,chapters,publishedLessons:chapters.reduce((n,ch)=>n+ch.lessons.length,0)}});return json({videos:visible.map(v=>projectVideo(v,canReadMemberContent(user))),courses:visibleCourses});}
   if(['/api/feed','/api/posts'].includes(path)&&method==='GET'){
    const posts=(await repo.list('articles',{publishedOnly:true})).map(a=>readerPost(a,user));
    if(path==='/api/feed')posts.push(...(await libraryVideos()).map(v=>videoPost(projectVideo(v,canReadMemberContent(user)))));
    const p=Object.fromEntries(url.searchParams);return json(orderPosts(filterPosts(posts,{query:p.q,contentType:p.type,market:p.market,stage:p.stage,symbol:p.symbol,tag:p.tag,month:p.month}),p.order==='asc'));
   }
   if((path.startsWith('/api/posts/')||path.startsWith('/api/articles/'))&&method==='GET'){
    const slug=decodeURIComponent(path.split('/')[3]),a=await repo.get('articles',slug,{publishedOnly:!user.isAdmin});if(!a)return json({error:'研究记录不存在或尚未发布'},404);
    const p=readerPost(a,user);return json(path.startsWith('/api/posts/')?p:{...toArticleDocument(p),locked:p.locked});
   }
   if(path==='/api/articles'&&method==='GET')return json((await repo.list('articles',{publishedOnly:true})).map(a=>{const p=readerPost(a,user),{sections,...summary}=toArticleDocument(p);return {...summary,locked:p.locked}}).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.publishedAt.localeCompare(a.publishedAt)));
   if(/^\/api\/watchlist\/[^/]+\/history$/.test(path)&&method==='GET'){const symbol=decodeURIComponent(path.split('/')[3]);const current=await repo.get('watch_items',symbol);if(!current||current.deletedAt&&!user.isAdmin)return json({error:'观察记录不存在或已删除'},404);return json(await repo.history(symbol));}
   if(path==='/api/watchlist'&&method==='GET')return json((await repo.list('watch_items')).filter(w=>!w.deletedAt));
   if(/^\/api\/watchlist\/[^/]+$/.test(path)&&method==='GET'){const symbol=decodeURIComponent(path.split('/')[3]);const current=await repo.get('watch_items',symbol);if(!current||current.deletedAt&&!user.isAdmin)return json({error:'观察记录不存在或已删除'},404);return json({item:current,history:await repo.history(symbol)});}
   if(['/api/admin/articles','/api/admin/watchlist'].includes(path)){
    const isArticle=path.endsWith('/articles'),table=isArticle?'articles':'watch_items';
    if(method==='GET')return json(await repo.list(table));
    if(!isArticle&&['DELETE','PATCH'].includes(method)){const input=await body(request);if(typeof input.symbol!=='string'||!Number.isInteger(input.revision))fail('缺少观察标识或版本号');if(method==='PATCH'&&input.action==='end'){const current=await repo.get(table,input.symbol);if(!current)fail('记录不存在',404);if(current.deletedAt)fail('该观察已在回收站',409);if(current.revision!==input.revision)fail('记录已更新，请重新载入',409);if(current.observationStatus==='ended')return json(current);return json(await repo.save(table,{...current,observationStatus:'ended',endedAt:new Date().toISOString(),isWeeklyFocus:false,updatedAt:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})},input.revision,user.id));}return json(await repo.archive(table,input.symbol,input.revision,method==='PATCH'))}
    if(method==='DELETE'&&isArticle){const input=await body(request),existing=await repo.get(table,input.slug);if(!existing)fail('记录不存在',404);if(!Number.isInteger(input.revision))fail('缺少版本号');return json(await repo.save(table,{...existing,status:'draft',pinned:false,deletedAt:new Date().toISOString(),updatedAt:new Date().toISOString()},input.revision,user.id))}
    if(method==='PUT'){const input=await body(request),value=isArticle?article(input):watch(input);if(isArticle){const sync=watchSync(input.watchSync,value);if(sync){const current=await repo.get('watch_items',value.symbol);if(current?.deletedAt)fail('该观察已在回收站，请先到内容管理恢复后再同步',409);if(current?.observationStatus==='ended'||current?.endedAt)fail('该观察已结束，不能继续同步更新',409);const saved=await repo.saveWithWatch(value,input.revision??0,user.id,sync);const observation=await repo.get('watch_items',value.symbol);return json({...saved,watchSyncResult:{symbol:value.symbol,revision:observation?.revision,isWeeklyFocus:!!observation?.isWeeklyFocus}})}}if(!isArticle){const current=await repo.get('watch_items',value.symbol);if(current?.observationStatus==='ended'||current?.endedAt)fail('该观察已结束，不能继续更新',409);if(value.articleSlug&&!await repo.get('articles',value.articleSlug,{publishedOnly:true}))fail('请关联已发布文章，或清空关联文章')}return json(await repo.save(table,value,input.revision??0,user.id))}
   }
   return json({error:'接口不存在'},404);
  }catch(error){const status=error.status||503;return json({error:status>=500?(error.publicMessage||'服务暂时不可用，请稍后重试'):error.message,...(status===428&&error.code==='reauthentication_required'?{code:error.code}:{})},status)}
 };
 return async request=>{const response=await handle(request);return auth.applyCookies?auth.applyCookies(request,response,publicOrigin(request,env).startsWith('https:')):response};
}
