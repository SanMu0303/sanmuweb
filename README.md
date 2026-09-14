# 趋势交易观察室

Next.js 15 + TypeScript + Tailwind，迁移目标为 Vercel + Supabase。

当前迁移分支已通过生产构建及真实图片存储测试，但原站 4 张图片原文件尚未取回，GitHub 写入凭据返回 403，尚未上线 Vercel。不要将代码构建通过当成迁移完成。

## 本地启动

使用 Node.js 22，安装与 pnpm-lock.yaml 对应的依赖：

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# 在 .env.local 中设置服务端环境变量
pnpm build
pnpm start --hostname 127.0.0.1 --port 3100
```

已有 .env.local 时不要覆盖。管理员登录 /login/，后台 /admin/。

## 服务端配置

- SUPABASE_URL：项目根地址。
- SUPABASE_SECRET_KEY：服务端 Secret key，不可暴露到客户端。
- SUPABASE_IMAGE_BUCKET：research-images，必须私有。
- ADMIN_EMAILS：逗号分隔的已确认管理员邮箱。
- APP_ORIGIN：可选固定站点来源；Vercel 预览通常留空，使用平台 HTTPS 与请求 Host。

在 Supabase 依次执行 supabase/migrations 中两份 SQL。Auth 用户需要在 Authentication 中创建并确认邮箱。Cookie 目前最多一小时，到期需重新登录；尚未接自动续期。

## 数据迁移

原站备份保存在被 Git 忽略的 .local/sites-backup-20260914。原图按 objects/posts/图片ID 放入备份目录，文件大小须匹配元数据。

```sh
node --env-file=.env.local scripts/check-supabase.mjs
node --env-file=.env.local scripts/import-sites-backup.mjs
# 完整验证且目标无冲突后才执行：
node --env-file=.env.local scripts/import-sites-backup.mjs --apply
```

导入遇到缺失原图或已存在的同名记录会停止，不覆盖线上数据。中途失败需先审查恢复，不能直接反复导入。

## 图片与权限

浏览器签名直传私有存储；后台验证真实文件类型和大小，数据库事务关联帖子及排序。访问原图先验证权限，再短时签名跳转。临时删除保留墓碑，防止旧上传凭据导致记录复活；72 小时过期记录在管理员下次上传时清理。尚未配置独立定时清理任务。

## Vercel

导入 GitHub 仓库，Framework 选 Next.js，Root Directory 选本项目根目录，Build Command 为 pnpm build，Output Directory 保持默认。配置上述服务端变量；迁移和登录/上传验收完成前只部署测试版，不切换正式域名。

## 检查

```sh
pnpm test:migration
node --env-file=.env.local scripts/test-supabase-images.mjs
```

后一个命令会在真实 Supabase 创建唯一命名的临时测试记录与图片，并清理它们。原 Sites 实现记录见 docs/sites-original-readme.md；不要使用旧 Sites 打包脚本部署当前 Vercel 分支。
