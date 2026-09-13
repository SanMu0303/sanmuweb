# 短帖多图上传

## 使用

首页“写一条” → 输入正文 → 图片 → 本地多选。也可直接拖入文件。
每张图有等待、上传、成功、失败状态；失败可重试，正文不会清空。
拖动缩略图调整顺序，手机或键盘用户可使用前移/后移按钮。删除完成前和图片未成功时不允许发布。
原图片链接入口保留在“通过 URL 添加图片”折叠区。

## 存储与权限

生产图片字节保存在 Cloudflare R2 的逻辑绑定 `IMAGES`，不是 Next.js 目录。
D1 的新增 `image_uploads` 表只保存归属、对象路径、图片元数据和临时/已关联状态。
原来的文章 JSON、路由、登录和会员模型保留。二进制上传 API 是 `/api/admin/images`；现有文章保存接口关联图片。
管理员身份沿用 Sites 可信身份头，不接受客户端自报身份。上传/删除校验管理员和同源。
`/api/images/:id` 按既有文章可见性返回图片：临时图仅上传者可读，未公开会员图不会因知道地址就绕过权限。
删除未发布图片会同步删除 R2 对象和元数据。正在上传的图先等待请求结束再删除；失败时保留删除重试机会。
已关联文章的图片不能通过“删除临时图”接口删除。发布失败会释放没有被文章引用的临时关联。
放弃编辑留下的临时图在 72 小时后，于该管理员下次上传时分批清理；不是独立定时任务。

本地预览使用 `.local/objects/posts/` 模拟对象存储，元数据在 `.local/content.sqlite`，全部被忽略，不随网站发布。

## 配置与兼容

`config/images.mjs`：9 张、单张 15 MiB、合计 50 MiB、上传超时 120 秒、临时保留 72 小时。
格式：JPEG / PNG / WebP；服务端检查大小和文件签名。GIF 尚未启用。
限制同时作用于客户端和上传服务；已有外部 URL 的字节大小不可预知，不计入本地文件大小预算。

新增图片数据：

```ts
{ id, url, thumbnailUrl, storagePath, width, height, mimeType, fileSize, sortOrder,
  alt, caption, isPreview }
```

`normalizeImages` 兼容 `images[]`、`imageUrl`、`imageUrls`。最终数组顺序决定发布顺序。
`lib/imageStorage.ts` 为客户端存储服务边界；`server/image-storage.mjs` 为服务端 R2 适配及权限边界。
本版保留原图，不做有损压缩，`thumbnailUrl` 暂与 `url` 相同。列表惰性加载；下一步可在服务端生成小图并更新 thumbnailUrl，Lightbox 继续使用原图。

## 展示

编辑预览：1 图单列、2–4 图两列、5–9 图三列，contain 保留图表文字完整性。
动态：单图约 500px、2/4 图两列、3/5–9 图三列；缩略网格固定高度，高清原图在 Lightbox 查看。
Lightbox 使用原生 dialog：计数、上一张、下一张、方向键、Esc/关闭、焦点恢复，移动端左右滑动切换。

## 验证

构建后运行 `npm test`。图片测试覆盖二进制 1/4/9 张、删除、顺序持久化、幂等上传、故障重试、管理员/同源校验、会员图片访问及旧数据兼容。
本地浏览器验收已验证 1→4→9 张上传、删除第 5 张、拖动第 9 张至第 4 位、发布八图及 Lightbox 4/8→5/8；断开本地服务后上传失败、恢复后重试成功；390px 页面无横向溢出。

## 本次修改文件

- `.openai/hosting.json`
- `app/admin/page.tsx`
- `app/home.css`
- `components/ImageLightbox.tsx`
- `components/ImagePreviewGrid.tsx`
- `components/ImagePreviewItem.tsx`
- `components/ImageUploader.tsx`
- `components/PostCard.tsx`
- `components/PostImages.tsx`
- `components/QuickComposer.tsx`
- `components/image-gallery.css`
- `config/images.d.mts`
- `config/images.mjs`
- `db/schema.ts`
- `docs/image-upload.md`
- `drizzle/0001_image_uploads.sql`
- `drizzle/meta/_journal.json`
- `lib/imageStorage.ts`
- `lib/posts.ts`
- `lib/useImageUploads.ts`
- `package.json`
- `scripts/build-worker.mjs`
- `scripts/local-image-storage.mjs`
- `scripts/local-server.mjs`
- `scripts/sqlite-adapter.mjs`
- `server/image-config.mjs`
- `server/image-model.mjs`
- `server/image-storage.mjs`
- `server/post-model.mjs`
- `server/worker.mjs`
- `tests/images.test.mjs`
