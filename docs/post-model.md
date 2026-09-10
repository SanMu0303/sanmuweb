# Post 数据模型与迁移边界

权威 TypeScript 契约：`lib/posts.ts`。标准 mock：`content/posts.json`。旧文章兼容、权限投影、过滤、排序：`server/post-model.mjs`。

| 字段 | 含义 |
|---|---|
| id / slug | 稳定记录 ID / 详情链接标识；旧记录沿用 slug 作为 id |
| title / summary | 标题与摘要 |
| content | 分段正文数组，每段 heading、text；可直接存为 Supabase JSONB |
| contentType | 观察更新、交易计划、交易反馈、市场复盘、教学内容 |
| format | short / long，决定内容流直接显示全文还是摘要 |
| symbol / market / sector | 标准化标的、市场、板块；时间线用 market + symbol 区分 |
| trendStage | 准备、启动、运行、高潮、失效；非标的内容可为空 |
| status / statusText | status 为 draft / published；statusText 为这次更新的研究判断 |
| timeframe | 1H、4H、1D 等观察周期 |
| tags / images | 标签；图片对象 url、alt、caption、isPreview |
| isPinned | 置顶；首页先展示且不在默认最新流重复出现 |
| isMemberOnly / isPublic | 全文会员限定 / 全文公开。会员记录仍有公开预览，不是隐形记录 |
| publishedAt / updatedAt | 带时区的 ISO 时间；首次发布时间用于生命周期与年月，更新时间用于首页倒序 |
| author / readTime | 作者对象与预计阅读分钟数，降低显示权重 |
| tradeId / watchlistId / relatedPosts | 已保留的关联字段，尚未增加独立交易实体或关联编辑界面 |
| isExample | 是否教学示例，界面明确标注 |
| locked / revision | 响应权限状态 / 乐观锁版本；locked 是服务端派生值，不允许前端授予权限 |

现有数据库的 articles.document 保持 JSON 文档形式，新增字段无需破坏性表迁移。旧 excerpt、sections、category、pinned、access、readMinutes 通过适配器映射为 summary、content、contentType、isPinned、isMemberOnly、readTime。`publishedAtTime` 在旧文档中保存精确发布日期，与后台日期输入兼容。保存操作自动更新 updatedAt。

后续 Supabase 建议建立 posts 表，将 id、slug、content_type、symbol、market、trend_stage、status、is_pinned、published_at、updated_at 提升为明确列，其余复杂字段使用 JSONB / text[]。索引优先 `(market, symbol, published_at)` 和 `(status, updated_at)`；内容预览应独立查询，会员正文只在经过服务端身份、有效期和 RLS 授权后返回。不要通过浏览器开关切换真实会员权限。

现有 Worker 查询在服务端先根据权限投影正文与图片，再搜索和返回。这样访客搜索隐藏正文的词汇不会泄露记录内容；长文公开正文可以被搜索，但首页仅渲染摘要与关键图。当前没有真实付费会员，仅管理员可读取全部会员正文。

示例图表只表达结构，不含真实报价或投资信号。首次种子导入幂等，重新发布不会覆盖已编辑的记录。
