# 邮箱、密码与验证码认证

本次替代之前的纯邮箱验证码登录流程。注册页为邮箱、密码、验证码；登录页为邮箱、密码；登录按钮下方小字“忘记密码”跳转 /forgot-password/，填写邮箱、新密码、验证码后重置并返回登录。

## 接口和验证

- POST /api/auth/register/send/：验证邮箱和新密码，调用 Supabase /signup 发出注册验证码，不创建网站会话。
- POST /api/auth/register/：使用 signup 类型验证验证码，再通过 /user 确认邮箱身份；将用户本次填写的密码设置成功后才写入登录 Cookie。这一步防止未验证邮箱曾被他人预注册时遗留他人的密码。
- POST /api/auth/login/：邮箱密码登录，服务端复核已确认邮箱及对应身份后写入 Cookie。既有密码不按新密码最小长度拦截。
- POST /api/auth/password/send/：调用 /recover，未注册邮箱也给出统一提示，不创建新账号。
- POST /api/auth/password/reset/：仅接受 recovery 类型验证码；复核身份后修改密码并结束恢复会话，清除当前网站 Cookie，返回登录页。设置结果不确定时提示先尝试新密码，必要时重新获取恢复验证码。
- 原 /api/auth/otp/send/ 和 /api/auth/otp/verify/ 返回 410，旧页面提示刷新及通过忘记密码设置密码。

新密码8–72字符，且UTF-8编码最多72字节；不会去除密码前后空格。客户端不保存密码或访问令牌。Cookie 保留 HttpOnly、SameSite=Lax，在 HTTPS 使用 Secure，最多一小时。管理员仍仅由 ADMIN_EMAILS 控制。

验证码发送保留60秒间隔，实际限流、8位验证码及有效期由 Supabase 控制。注册邮件使用 Confirm sign up 模板，找回密码使用 Reset password 模板；正文均为 {{ .Token }}，不依赖邮件链接。重复注册已确认账号可能返回隐藏账号存在性的成功响应，因此发送提示不保证该地址一定有邮件。

之前仅使用验证码登录、未设置密码的账号，通过忘记密码建立自己的密码。真实用户密码由用户本人填写和提交，验收不替用户更改密码。

## 验证与发布

运行认证与Supabase相关测试、TypeScript检查和生产构建。发布须核对 GitHub 文件与本地版本一致、Vercel 正式部署 Ready，并检查正式域名三个表单及验证码邮件。真实密码注册/重置最后一步由账号所有者执行。

参考：
- https://supabase.com/docs/reference/javascript/auth-signup
- https://supabase.com/docs/reference/javascript/auth-verifyotp
- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
- https://supabase.com/docs/reference/javascript/auth-updateuser
- https://github.com/supabase/auth/blob/master/internal/api/signup.go
