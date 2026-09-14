# Vercel 部署检查（2026-09-13）

## 结论与验证

当前不能将完整网站直接迁移到 Vercel。静态前端能够构建，但后台依赖 Sites Worker、D1、R2 和 Sites 登录。构建通过不等于后端兼容。

实际依次执行 package.json 的完整 production build 两个步骤：`next build`、`node scripts/build-worker.mjs`，均退出 0；Next.js 15.5.25 导出 30 个页面，类型检查通过。13 项现有测试全部通过。当前机器未提供 npm/pnpm/bun 可执行文件，因此使用已安装 Node 直接执行相同命令；没有发现需要修复的源代码 build error。未进行 Vercel 实际部署或干净环境依赖重装。

本次只新增此检查文档，没有改功能、运行时配置或线上站点。

## 阻碍与代码位置

|位置|检查结果|
|---|---|
|next.config.ts|output: export，产物 out 是静态站点，不含动态后端|
|scripts/build-worker.mjs|另外生成 dist/server/index.js，属于 Sites/Cloudflare Worker 入口，Vercel 不会自动将其注册为 API|
|server/worker.mjs|所有 /api/*、管理发布、查询依赖此 Worker；app 中没有对应 API Route Handlers|
|lib/live.ts、lib/imageStorage.ts|使用同源 /api/*；未发现生产代码把请求指向 localhost，但 Vercel 上无这些接口会失败|
|server/worker.mjs identity()|信任 Sites 注入的 oai-authenticated-user-* 请求头；Vercel 不提供该身份网关，移植时必须改成服务器验证的会话，不能信任用户自带请求头|
|app/login/page.tsx、components/QuickComposer.tsx|/signin-with-chatgpt 为 Sites 专用登录入口，不能原样搬到 Vercel|
|server/image-storage.mjs|依赖 env.DB 与 env.IMAGES；15 MiB 图片通过 API 代理上传/读取，不能原样搬到 Vercel Functions 的 4.5 MB 请求/响应限制内|
|scripts/local-server.mjs|仅本机开发：127.0.0.1、模拟管理员登录、.local/content.sqlite；不能作为生产服务|
|scripts/local-image-storage.mjs|图片写入 .local/objects，仅本地开发，不是线上存储方案|
|app/articles/[slug]、app/courses/[courseId]|静态参数来自 JSON；新路径要重新构建。Sites Worker 的 /articles/:slug 重定向在 Vercel 上也不会自动存在；现有 /article/?slug= 入口依赖 API|
|content/videos.json、content/courses.json|随版本发布的课程示例，视频源仍有占位；不是在线视频 CMS 或真实学习进度系统|

扫描 app/components/lib/server/content/public：未发现生产业务引用本机绝对路径、file://、localhost 开发 API。本地地址集中于开发脚本和说明文档。构建脚本相对路径依赖项目根目录，应正确设置 Vercel Root Directory。

## 环境变量与数据

当前唯一业务环境变量：`ADMIN_EMAILS`（逗号分隔管理员邮箱，服务端使用）。它只配置权限名单，不提供登录功能。在当前静态 Vercel 部署中填入它也不会产生后台。

`DB`、`IMAGES`、`ASSETS` 是 Sites 运行时对象绑定，不能在 Vercel Environment Variables 中填字符串来替代。当前没有已实现的 DATABASE_URL、Supabase 或 S3 环境变量接口，不应假设填凭据即可完成迁移。

迁移实现后需要的配置类别：数据库连接凭据、对象存储桶及服务端凭据、认证服务密钥和回调地址、ADMIN_EMAILS。确切变量名由选定适配器确定；凭据不要用 NEXT_PUBLIC_ 暴露给浏览器。

数据现状：

- 已上线 Sites 的文章、草稿、观察池、修订号、图片元数据保存在 D1，原图在 R2；它们已经持久化，但 GitHub/Vercel 导入不会自动复制，原站数据也不会因此自动消失。
- 本机 .local/content.sqlite 与 .local/objects 被 Git 忽略，不会随仓库部署。不能改为写 Vercel 临时文件来解决长期存储。
- content/*.json 和 public 文件是版本化静态内容，重新部署仍在，但后台写入不会回写这些 JSON。
- 编辑器尚未提交的文字/预览是页面内存状态，刷新不保留；学习进度、普通会员支付/解锁尚未实现持久化，不存在可迁移的真实进度。

完整 Vercel 上线前必须完成：持久数据库适配及 D1 数据迁移；对象存储与图片迁移；安全会话认证；API 的 Vercel 路由适配或安全的独立后端；大图使用授权直传和受控下载（会员图不能简单公开）。这些属于后端迁移，本次没有新增。

## GitHub + Vercel 操作步骤

### A. 当前代码的静态预览（不等于完整上线）

1. 在 GitHub 创建空的私有仓库，不自动生成 README。当前项目已有 Git 和 Sites remote，保留 origin，另加 github remote。
2. 在项目目录执行，替换账号与仓库名：

```sh
git status --short
git remote add github https://github.com/YOUR_ACCOUNT/YOUR_REPO.git
git push -u github main
```

若 github remote 已存在，先检查地址，不重复添加。新增文档或后续修复需先审阅、提交再推送。不要上传 .env、.local、node_modules 或构建目录；现有 .gitignore 已排除。

3. Vercel → Add New → Project → 连接 GitHub → 导入这个仓库。
4. Root Directory：若仓库根目录就是本项目，选根目录；若上传的是上层工作区，选 outputs/trend-observatory，必须能看到 package.json 与 pnpm-lock.yaml。
5. 为明确只托管静态产物，Framework Preset 选 Other；Install Command `pnpm install --frozen-lockfile`；Build Command `pnpm exec next build`；Output Directory `out`。使用受支持的 Node 22.x；采用兼容 lockfile v9 的 pnpm。Development Command 不用于生产启动，不要运行本地模拟服务器。
6. 此静态预览不需要环境变量。Deploy 后检查页面外壳；/api/feed、/api/library、登录、上传与后台会缺失，不能把这个结果当作正式可用网站或切换正式域名。

### B. 完整网站正式上线（须先完成上述后端迁移）

1. 保留原 Sites 站点；备份并导出 D1 数据和 R2 对象，核对数量与图片路径关系。不要把只有 mock JSON 的 GitHub 仓库当作完整备份。
2. 将现有 API 接到 Vercel Route Handlers，并接持久数据库与对象存储，替换 Sites 登录；若改为 Next.js 服务端运行，移除 output: export，分离 Sites 打包步骤。或者保留独立后端，但必须解决跨域、身份验证、CSRF 和图片鉴权，不能简单代理私有 Sites URL。
3. 把适配代码推送 GitHub 的迁移分支，在 Vercel 创建 Preview；此时 Framework Preset 用 Next.js、Output Directory 保持框架默认、Build Command 用适配后的 production build。
4. 在 Settings → Environment Variables 填适配器实际要求的数据库/存储/认证变量与 ADMIN_EMAILS，区分 Preview 和 Production；登记认证回调地址，重新部署后生效。Preview 使用测试数据与测试桶。
5. 按迁移脚本初始化数据库并导入数据/对象；保持 slug、图片 ID、所有权、会员可见性和排序关系。不要在每次构建时重置或覆盖生产数据。
6. 验收匿名浏览、管理员登录、草稿、编辑刷新、退出后权限、多图 1/4/9 张、15 MiB 大图、失败重试、排序、删除、会员图拒绝访问、课程/文章深链接。重新部署一次后确认新发内容与图片仍存在。
7. 合并 main，确认 Production 部署成功后添加自定义域名，按 Vercel 显示的 DNS 记录配置；更新正式回调地址并再次验收。保留原站和备份用于回退。

## 官方资料

- https://vercel.com/docs/git
- https://vercel.com/docs/builds/configure-a-build
- https://nextjs.org/docs/app/guides/backend-for-frontend
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/errors/function_payload_too_large

以上是基于当前代码和官方文档的兼容性检查；没有创建 GitHub 仓库、Vercel 项目，也没有迁移或修改线上数据。
