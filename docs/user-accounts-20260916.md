# 用户注册与个人中心

- /register/：邮箱、密码、昵称注册，沿用 Supabase 邮箱确认策略。
- /login/：普通用户和管理员均可登录。管理员仍由已确认邮箱和服务端 ADMIN_EMAILS 判断，不信任用户元数据中的权限声明。
- /profile/：修改昵称、选择头像、保存和退出。右上角头像和昵称可进入个人中心。
- 昵称保存到 Supabase Auth user_metadata.nickname；头像保存到 research-images 私有桶 avatars/<用户ID>/<随机ID>.jpg，metadata只保存自己的对象路径。
- 头像在浏览器裁剪压缩为256×256 JPEG；服务端限制128KB并检查JPEG格式，仅登录用户可为自己的账号保存。
- 不需要新的 SQL；不自动解锁付费内容；现有 HttpOnly/SameSite/Secure 会话策略保持。

## 验证
51项自动测试通过，production build通过。
临时普通账号测试通过：真实登录、昵称与头像持久化、签名头像读取、所有管理员内容接口403。
临时账号和头像已清理。该账号由验收流程创建并确认，仅用于登录/资料验证，不能代表注册邮件投递已验证。

## 邮件配置待确认
当前 Supabase 允许注册，开启邮箱确认。
上线前应确认 Authentication 的自定义 SMTP、Site URL 和 Redirect URLs。
Site URL：https://sanmuweb.vercel.app
Redirect URLs：https://sanmuweb.vercel.app/login/**
默认SMTP只支持项目团队收件人，不能作为面向普通用户的正式邮件服务。
参考：https://supabase.com/docs/guides/auth/auth-smtp
本次未关闭邮箱确认，也未绕过普通用户邮箱验证。需要使用实际收件邮箱完成注册邮件投递与确认验收。
