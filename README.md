# 趋势交易观察室

暗色、内容优先的会员研究站 MVP。Next.js App Router + TypeScript + Tailwind CSS 4，支持静态导出。

## 启动

需要 Node.js 20.9+，推荐 Node.js 22/24，以及 pnpm。

```sh
pnpm install
pnpm dev
```

打开终端显示的地址（默认 http://localhost:3000）。

```sh
pnpm typecheck
pnpm build
```

构建生成 `out/`，可部署到静态托管。预览生产导出可运行 `python3 -m http.server 3000 --directory out`。因为使用静态导出，不使用 `next start`。也可用 npm 安装并执行对应脚本，但仓库以 pnpm-lock.yaml 为准。

## 已有页面

- `/`：重点观察卡片、最新内容流、分类、搜索、标签过滤、置顶、会员预览标记。
- `/watchlist/`：按市场、阶段筛选的趋势观察池，含失效条件。
- `/reviews/`：市场复盘。
- `/knowledge/`：趋势课程与交易计划模板。
- `/articles/[slug]/`：独立文章详情页，会员文章仅输出首段预览。
- `/membership/`、`/login/`：明确标注尚未开放的账号与会员入口。
- 未找到的页面显示 404。

## 目录

```text
app/                 路由、页面、全局样式
  articles/[slug]/    文章详情与文章元数据
components/          导航、搜索内容流、观察池筛选
content/
  articles.json      文章数据（7 篇教学示例）
  watchlist.json     观察数据（3 项教学示例）
lib/
  types.ts           文章与观察数据模型
  repository.ts      异步数据访问层
.openai/hosting.json Sites 静态托管配置
next.config.ts       静态导出与目录式路由
```

## 下周如何开始更新

1. 在 `content/articles.json` 复制一篇记录，填写唯一 `slug`、标题、摘要、分类、标签和日期。
2. `category` 可选：趋势观察 / 市场复盘 / 趋势课程 / 交易计划。
3. `access` 设为 `public`（全文公开）或 `member`（仅首段预览）；`pinned` 控制置顶。正文是 `sections` 数组，每段包含 `heading` 和 `text`。
4. 更新 `content/watchlist.json` 中的观察依据、阶段、失效条件和日期。`articleSlug` 必须指向已有文章。
5. 运行构建并发布 `out/`。这是文件式内容管理，修改内容后需重新构建发布；尚无网页编辑后台。

示例：

```json
{"slug":"weekly-2026-09-13","title":"本周市场复盘","excerpt":"记录本周判断及变化。","category":"市场复盘","tags":["周复盘"],"publishedAt":"2026-09-13","pinned":false,"access":"public","readMinutes":3,"sections":[{"heading":"本周观察","text":"填写实际记录。"}]}
```

当前全部内容为教学样例，不代表真实持仓、行情或投资建议。发布正式研究前请替换样例。

## 后续 Supabase / API 接入

页面通过 `lib/repository.ts` 读取数据；将这三个异步读取方法替换为服务端 Supabase 或 HTTP API 即可沿用页面模型。建议表结构：`articles`（当前文章字段 + id/status/updated_at）、`watch_items`（观察字段 + id）、`profiles`、`memberships`（user_id/status/expires_at）。正文可以继续保留结构化 JSON。

真实会员上线时，移除静态导出，加入服务端会话、身份验证、会员有效期检查和数据库 RLS，正文与公开摘要分别查询。客户端不能通过 UI 开关自行提升权限。当前会员正文不会输出至生成页面，但本地 JSON、源码仓库和构建环境均不构成付费内容的安全存储。不要在本版源文件中放真正保密内容。

真实支付、账号系统、收藏、阅读历史、在线 CMS 和自动行情均不在本版范围。没有伪造登录或支付成功，也没有收集用户个人信息。

## 发布

`out/` 可部署到 Sites、Cloudflare Pages 或其他支持目录式静态路由的托管平台。Sites 的访问权限与本网站的会员权限是两套机制，私有预览仅用于站点验收。正式公开发布之前应完成账号权限与正式内容替换。
