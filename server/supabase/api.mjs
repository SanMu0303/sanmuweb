import {createProfile} from './profile.mjs';
import {createVideos} from './videos.mjs';
import {createImages} from './images.mjs';
import {createRepository} from './repository.mjs';
import {createAuth,sessionCookie} from './auth.mjs';
import {checkMutation,publicOrigin} from './request-security.mjs';
import {article,watch,watchSync} from '../content-validation.mjs';
import {projectPost,filterPosts,orderPosts} from '../post-model.mjs';
import {projectVideo,videoPost} from '../video-model.mjs';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
async function body(request){if(Number(request.headers.get('content-length'))>250000)fail('内容过大',413);const raw=await request.text();if(raw.length>250000)fail('内容过大',413);try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))fail('内容格式不正确');return value}catch{fail('内容格式不正确')}}
/** @param {{env?: NodeJS.ProcessEnv, repo?: ReturnType<typeof createRepository>, auth?: ReturnType<typeof createAuth>, videos?: object[], courses?: object[]}} options */
export function createApi({env=process.env,repo=createRepository(),auth=createAuth(env),videos=[],courses=[]}={}){
 return async request=>{
  try{
   const url=new URL(request.url),path=url.pathname.replace(/\/$/,''),method=request.method;
   if(!['GET','HEAD'].includes(method)){
    const check=checkMutation(request,env);
    if(!check.ok){console.warn('Request rejected',{path,status:403,reason:check.reason,origin:request.headers.get('origin'),expected:check.expected,contentType:request.headers.get('content-type')});return json({error:check.reason==='origin'?'请求来源不正确，请从当前网站重新打开登录页':'请求内容类型不正确，请使用 JSON'},403)}
   }
   if(path==='/api/auth/otp/send'&&method==='POST'){const input=await body(request);return json(await auth.sendOtp(input.email))}
   if(path==='/api/auth/otp/verify'&&method==='POST'){const input=await body(request),session=await auth.verifyOtp(input.email,input.code);return json(session.user,200,{'Set-Cookie':sessionCookie(session.token,session.expires,publicOrigin(request,env).startsWith('https:'))})}
   if(['/api/auth/login','/api/auth/register'].includes(path)&&method==='POST')return json({error:'已改为邮箱验证码登录，请刷新页面后获取验证码。'},410);
   if(path==='/api/auth/logout'&&method==='POST'){await auth.logout(request);return json({signedOut:true},200,{'Set-Cookie':sessionCookie('',0,publicOrigin(request,env).startsWith('https:'))})}
   const user=await auth.identify(request);
   if(path==='/api/session'&&method==='GET')return json({...user,configured:!!env.ADMIN_EMAILS});
   if(path==='/api/profile'||path==='/api/profile/avatar'){if(!user.signedIn)return json({error:'请先登录'},401);if(path.endsWith('/avatar')&&method==='GET')return await createProfile().avatar(request,auth);if(path==='/api/profile'&&method==='GET')return json(user);if(path==='/api/profile'&&method==='PUT')return json(await createProfile().save(request,await body(request),auth));}
   if(path.startsWith('/api/admin/')&&!user.isAdmin)return json({error:user.signedIn?'当前账号没有管理权限':'请先登录管理员账号'},user.signedIn?403:401);
   if(path.startsWith('/api/images/')||path.startsWith('/api/admin/images'))return await createImages().handle(request,user,repo);
   if(path.startsWith('/api/video-files/')||path==='/api/admin/videos'||path==='/api/admin/video-uploads')return await createVideos(undefined,undefined,videos).handle(request,user,repo);
   const libraryVideos=async()=>{const saved=await repo.list('videos');return [...saved.filter(v=>v.status==='published'&&!v.deletedAt),...videos.filter(v=>!saved.some(s=>s.id===v.id))]};
   if(path==='/api/library'&&method==='GET'){const visible=await libraryVideos();const ids=new Set(visible.map(v=>v.id));const visibleCourses=courses.map(c=>{const chapters=(c.chapters||[]).map(ch=>({...ch,lessons:ch.lessons.filter(l=>l.contentType!=='video'||ids.has(l.contentId))}));return {...c,chapters,publishedLessons:chapters.reduce((n,ch)=>n+ch.lessons.length,0)}});return json({videos:visible.map(v=>projectVideo(v,user.isAdmin)),courses:visibleCourses});}
   if(['/api/feed','/api/posts'].includes(path)&&method==='GET'){
    const posts=(await repo.list('articles',{publishedOnly:true})).map(a=>projectPost(a,user.isAdmin));
    if(path==='/api/feed')posts.push(...(await libraryVideos()).map(v=>videoPost(projectVideo(v,user.isAdmin))));
    const p=Object.fromEntries(url.searchParams);return json(orderPosts(filterPosts(posts,{query:p.q,contentType:p.type,market:p.market,stage:p.stage,symbol:p.symbol,tag:p.tag,month:p.month}),p.order==='asc'));
   }
   if((path.startsWith('/api/posts/')||path.startsWith('/api/articles/'))&&method==='GET'){
    const slug=decodeURIComponent(path.split('/')[3]),a=await repo.get('articles',slug,{publishedOnly:!user.isAdmin});if(!a)return json({error:'研究记录不存在或尚未发布'},404);
    const p=projectPost(a,user.isAdmin);return json(path.startsWith('/api/posts/')?p:{...a,sections:p.content,images:p.images,locked:p.locked});
   }
   if(path==='/api/articles'&&method==='GET')return json((await repo.list('articles',{publishedOnly:true})).map(({sections,...a})=>({...a,images:projectPost(a,user.isAdmin).images})).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.publishedAt.localeCompare(a.publishedAt)));
   if(/^\/api\/watchlist\/[^/]+\/history$/.test(path)&&method==='GET'){const symbol=decodeURIComponent(path.split('/')[3]);const current=await repo.get('watch_items',symbol);if(!current||current.deletedAt&&!user.isAdmin)return json({error:'观察记录不存在或已删除'},404);return json(await repo.history(symbol));}
   if(path==='/api/watchlist'&&method==='GET')return json((await repo.list('watch_items')).filter(w=>!w.deletedAt));
   if(['/api/admin/articles','/api/admin/watchlist'].includes(path)){
    const isArticle=path.endsWith('/articles'),table=isArticle?'articles':'watch_items';
    if(method==='GET')return json(await repo.list(table));
    if(!isArticle&&['DELETE','PATCH'].includes(method)){const input=await body(request);if(typeof input.symbol!=='string'||!Number.isInteger(input.revision))fail('缺少观察标识或版本号');return json(await repo.archive(table,input.symbol,input.revision,method==='PATCH'))}
    if(method==='DELETE'&&isArticle){const input=await body(request),existing=await repo.get(table,input.slug);if(!existing)fail('记录不存在',404);if(!Number.isInteger(input.revision))fail('缺少版本号');return json(await repo.save(table,{...existing,status:'draft',pinned:false,deletedAt:new Date().toISOString(),updatedAt:new Date().toISOString()},input.revision,user.id))}
    if(method==='PUT'){const input=await body(request),value=isArticle?article(input):watch(input);if(isArticle){const sync=watchSync(input.watchSync,value);if(sync){const current=await repo.get('watch_items',value.symbol);if(current?.deletedAt)fail('该观察已在回收站，请先到内容管理恢复后再同步',409);const saved=await repo.saveWithWatch(value,input.revision??0,user.id,sync);const observation=await repo.get('watch_items',value.symbol);return json({...saved,watchSyncResult:{symbol:value.symbol,revision:observation?.revision,isWeeklyFocus:!!observation?.isWeeklyFocus}})}}if(!isArticle&&value.articleSlug&&!await repo.get('articles',value.articleSlug,{publishedOnly:true}))fail('请关联已发布文章，或清空关联文章');return json(await repo.save(table,value,input.revision??0,user.id))}
   }
   return json({error:'接口不存在'},404);
  }catch(error){const status=error.status||503;return json({error:status>=500?'服务暂时不可用，请稍后重试':error.message},status)}
 };
}
