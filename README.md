# 趋势交易观察室 · 研究日志版

Next.js 15 + TypeScript + Tailwind CSS 前端，Cloudflare Worker API + D1 在线内容库。保留原有暗色内容首页，并增加管理员编辑与年月归档。

## 编辑入口

网站左侧「内容管理」或 `/admin/`。线上使用 ChatGPT 登录；只有 Sites 环境变量 `ADMIN_EMAILS` 指定的已验证邮箱可管理。该环境变量只在服务端使用，默认空值会拒绝所有管理员操作。Sites 的访问权限和本应用的管理员权限分别检查。

文章支持：新增、修改、标签、栏目、发布日期、置顶、公开／会员预览、分段正文、排版预览、保存草稿、发布、下架为草稿。文章标识首次保存后固定，避免旧链接失效。会员内容仅首段对访客返回；管理员可读全文。普通读者的付费解锁仍未接入。

草稿仅管理员可见。保存失败保留输入；版本冲突返回 409，防止多个编辑窗口互相覆盖。离开未保存内容会提示。没有自动保存，关闭页面前请点击保存。

观察池支持新增和编辑：名称、市场、趋势阶段、关注依据、失效条件、日期以及关联的已发布文章。

## 历史导航

首页、市场复盘和知识库的内容流右侧提供「时间档案」。点击年份展开月份，点击有内容的月份跳转到该月列表；灰色月份没有文章。点击「最近」清除日期筛选。月份保存在 URL 的 `month=YYYY-MM` 参数中，刷新和浏览器前后退均可恢复。年月由已发布文章的 `publishedAt` 自动生成。可填写历史日期补录；发布日期不是定时发布功能。

当前示例文章都在 2026 年 9 月，所以初始只有 2026 年。新增其他年份文章后自动出现相应年份，不伪造历史记录。

## 本地运行

需要 Node.js 22.13+（推荐 24，使用内置 SQLite）和 pnpm。

```sh
pnpm install
pnpm build
pnpm dev
```

打开 http://127.0.0.1:3000 。本地服务器包含持久 SQLite 数据库 `.local/content.sqlite`，只监听本机，模拟登录只用于开发，不会打包上线。修改代码后重新构建并重启服务器。`pnpm dev:web` 仅运行 Next.js 前端，不能单独完成后台保存。

```sh
pnpm test
pnpm typecheck
```

测试覆盖管理员拒绝、草稿隔离、发布／下架、会员正文过滤、重复标识、乐观锁冲突、跨站写入、观察关联校验和数据库不可用。

## 目录结构

```text
app/admin/             内容管理页
app/article/           通用文章详情，支持新增文章无需重建
components/Archive.tsx 年份／月份历史导航
components/Feed.tsx    内容筛选、搜索和归档链接状态
lib/live.ts            在线数据读取与错误处理
server/worker.mjs      Worker API、验证、授权和 D1 访问
content/               首次数据库初始化用的示例种子
scripts/build-worker.mjs Worker 和静态前端打包
scripts/local-server.mjs 本地 SQLite 预览
scripts/sqlite-adapter.mjs 测试及本地 D1 兼容适配器
db/schema.ts           初始 SQL 模型
drizzle/               有版本的 D1 SQL 迁移与迁移日志
tests/                 后端权限及保存流程测试
```

`pnpm build` 输出 `dist/server/index.js`（ESM Worker 默认 fetch 对象）、`dist/client/`、`dist/.openai/hosting.json` 和数据库迁移。此版本不能只部署 `out/`，否则没有在线数据库和保存接口。

## 在线部署与内容持久性

`.openai/hosting.json` 声明 `d1: "DB"`。Sites 负责数据库绑定与迁移，管理员邮箱在 Sites 环境变量中配置。首次请求使用独立、幂等的种子导入，之后重新发布代码不会覆盖在线文章。以后日常内容更新在后台保存即可，无需重新构建。

迁移工具的安装在当前环境被权限策略阻止，因此初始 SQL 通过项目内零依赖脚本生成，使用 Drizzle 兼容的迁移日志格式；不是 drizzle-kit 的输出。首次迁移已经存在，不应再次运行生成器或修改已上线迁移。后续数据库结构变更应追加新迁移并保留原文件。

登录身份由 Sites 网关注入，不接受前端自报邮箱。自行托管时必须提供同等可信的认证网关，不能将 Worker 直接放到允许伪造身份头的入口。D1 数据不在浏览器存储中，后台账户功能不会随浏览器清理而丢失。

## 限制

正文目前是分段纯文本，可换行，不是富文本图片上传编辑器。普通读者付费会员尚未实现。所有初始内容仍为教学样例，请用自己的实际记录替换。源代码里种子仅供首次初始化；不要通过修改种子更新已上线数据库。

已添加可选的 WebMCP「保存当前草稿」工具。当前环境没有可用的 WebMCP 验证上下文，因此未验证浏览器端工具注册；普通按钮保存不依赖 WebMCP。


## 本次首页升级

首页现在按置顶研究、当前重点观察和最近研究动态组织。`short` 在内容流展开正文，`long` 展示摘要与首张研究图，详情页阅读全文。作者仅保留在记录底部。没有加入点赞、评论等社交控件。

`/symbol/?symbol=DOGE&market=加密` 是标的时间线入口。同一市场、同一标准化标的自动关联，默认按首次发布日期从早到晚排列，可切换方向。首页按更新时间倒序，置顶独立显示。历史年月依然按发布日期归档。搜索匹配标题、正文、标的、板块及标签；筛选支持五种内容类型、市场、阶段、标的和年月。筛选模式把所有匹配的置顶记录也纳入结果，不在顶部重复显示。

`content/posts.json` 是当前标准 Post 种子数据，包含 16 条明确标记的教学示例，包括 DOGE 的五次生命周期记录。`content/articles.json` 仅保留为旧版兼容样例，不再作为当前初始化来源。在线发布后的正常编辑以数据库为准；修改种子不会覆盖已有记录。新的种子标记采用幂等插入。

新组件：PostCard、ResearchFilters、FocusObservations、ResearchSidebar、SymbolTimeline。Feed、ArticleView、Collection、管理员编辑器和 Archive 继续复用。图表位于 `public/charts/`，均为无真实价格刻度的教学示意图。

完整数据说明见 `docs/post-model.md`。新增 API `/api/posts` 与 `/api/posts/:slug` 输出标准 Post；旧 `/api/articles` 为后台兼容保留。两套接口均在服务端裁剪会员正文与非预览图片，搜索不索引访客无权读取的付费正文。管理员有权完整阅读。

本周重点根据当周更新、每个标的最后一条记录生成；已经失效的机会不会被早先的运行阶段重新加入重点。侧栏另提供入门路径和研究主题。

当前不含真实行情、付费会员解锁、图片文件上传、收藏、阅读历史、评论或点赞。图片通过管理员填写现有 HTTPS 链接或本站图表路径添加。内容并非浏览器本地存储，已保留 D1 持久性。


## 视频知识库（示例阶段）

知识库默认显示视频，支持全部 / 视频 / 文章 / 案例。`/video/?id=video-01` 展示播放器、混合课程目录、前后集及关联笔记。首页和标的时间线通过 `/api/feed` 聚合研究记录与视频，原 `/api/posts` 行为保持不变。

- `content/videos.json`：Video 数据，contentType 固定为 video。原 Post 的中文 contentType 仍表示研究用途，format 区分短帖和长文，避免破坏旧数据。
- `content/courses.json`：Course → Chapter → Lesson，Lesson 通过 contentType 与 contentId 引用视频或文章。
- `lib/videos.ts`：类型、秒数时长与详情链接。symbol + market 使用与 Post 相同的关联键，relatedPosts / relatedVideos 引用稳定 ID。
- `components/VideoPlayer.tsx`：YouTube、Bilibili 的限定域名嵌入，以及 selfHosted / cdn 的 HTML5 video；列表不创建播放器。
- `/api/library` 在服务端移除访客的会员完整 videoUrl，只返回 previewUrl（需独立裁剪的试看文件）。管理员可读取完整地址。

目前 6 节视频为结构示例，视频地址留空并展示待上传 / 试看占位；封面为现有结构示意图，并非真实视频截图。视频与课程暂从 mock JSON 读取，尚无视频后台编辑、上传、实际付费会员和签名媒体地址。旧内容编辑入口继续管理短帖 / 长文。下一步应把视频管理接入内容后台，并为私有媒体增加服务端授权和短期签名地址；不能只用公开文件 URL 保护付费视频。不改变当前 D1 表和已应用迁移。
