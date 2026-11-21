# D：业主密码登录入口

日期：2026-11-14；起始基于 main d6255e1，开发中快进同步至 c0ecb02，已包含维护者合入的 #84 PUT 鉴权。本 PR 独立提供账号密码登录。

## 本次协议与范围

- `POST /api/auth/owner` 接受严格的 `OwnerLoginInput`：login（3–64 位 ASCII 字母、数字、点、下划线、连字符，去除首尾空白并转小写）和 password（15–128 字符，原值不 trim）。禁止 userId、role、providerId 等身份字段。不提供公开注册、按 userId 签发或默认账号密码。
- 维护者运行 `npm run owner:create`，在本机交互输入账号、显示名称及隐藏的密码/确认密码；创建新 owner 和独立密码凭证，不绑定或接管已有 demo-owner。已有登录名拒绝覆盖。数据库只存随机盐 scrypt 摘要；密码不会进入命令参数、环境变量、日志、seed 或仓库。
- 密码校验使用 Node 内置 scrypt（N=131072, r=8, p=1），比较固定长度摘要；不存在的账号也执行相同计算。未找到账号、密码不符、当前角色不再是 owner、验证期间凭证变化均为相同 401 `INVALID_CREDENTIALS`。存储/摘要损坏为中性 503，不返回内部错误。
- 2026-11-14 反馈修正：同一 SQLite 仅记录认证失败，每登录名 15 分钟最多 5 次失败，成功不计数且清零；移除全局 60 次锁定。未知账号同样处理；超限 429 `RATE_LIMITED` 和 Retry-After；进程同时最多执行 2 次密码计算，繁忙返回短暂 429，不计失败。不信任客户端转发 IP，重启不会清除数据库限频。新版键避免继承旧版成功次数，详见 `D-owner-login-throttle.md`。
- POST/DELETE 要求同源 Origin，拒绝 cross-site；只在 HTTPS 或 localhost/127.0.0.1/[::1] 开发回环来源使用，不信任 forwarded host/proto。正文上限 4096 字节，非法或超大输入 400，不消费鉴权存储。
- POST 先检查失败窗口、读凭证，在事务外计算密码，再在同一写事务重验失败窗口和当前凭证/账号角色，撤销此浏览器原业主会话、调用已有 `issueOwnerSession` 并清除本账号失败记录。只有认证失败增加失败次数。成功返回 `OwnerSessionState` signed_in 和 `meta.source: live`；真实随机 cookie 只经 Set-Cookie 交付。保留已有 `__Host-ai_home_owner_session` 的 Secure、HttpOnly、SameSite=Strict、Path=/、30 分钟绝对有效期，不降低 cookie 属性。
- GET 不续期，在事务内读取实际 cookie、当前账号和过期/撤销状态；成功为 signed_in（OwnerIdentity + expiresAt）或 signed_out。非 owner 的旧凭证返回 signed_out，存储故障 503。DELETE 即使凭证已失效也可幂等退出；事务撤销成功后才清除 cookie，数据库故障不得声称退出成功。所有响应 private, no-store 和 Vary: Cookie。
- UI 位于共享布局，使用公共类型及 api-client；密码提交后清空，不存 localStorage/URL。接口失败或 501 不显示已登录；刷新、页面聚焦和到期时重新读取状态。服务方演示会话与业主会话独立，不相互转换。

## 边界与交接

这是维护者开通账号的密码认证，验证账号密码，不代表实名认证；无公开注册、找回密码、MFA 或第三方登录。没有自动给演示账号开通密码。测试账号/需求为隔离 SQLite 合成数据，不是生产身份或真实业务数据。

已有 `OwnerIdentity`、`issueOwnerSession` 与 `readOwnerVerifiedSession` 签名不变，B 可继续按原协议接报价读取。#84 已合入，密码登录凭证可用于 PUT 本人需求；DELETE、POST 固定 demo-owner 和列表/详情隔离仍待后续修复。#79 的来源测试阻塞另由 D 在 PR #87 修复，本次未复制 B 分支。本次不宣称报价或需求浏览器业务全链路已完成。

## 验收计划

隔离 SQLite 验证开通账号不覆盖旧用户、无明文密码、有效/错误/未知密码、公共字段拒绝、大小限制、同源和 HTTPS 检查、持久化限频、凭证/角色变化事务重验、轮换旧 cookie、过期/撤销/退出、存储失败与回滚；公开路由及共享 UI 不把 501/mock 当作真实登录。浏览器使用临时合成账号验证登录、刷新、错误密码及退出。

参考：Node crypto scrypt、OWASP Password Storage 与 Authentication Cheat Sheets；不增加依赖或更换技术栈。

## 已执行验证

- 13 项登录定向测试及全量 `npm run check`（480 项）通过；类型、lint、模块边界与 `npm run build` 通过。`npm run scope -- --role D --base origin/main` 通过（18 个文件），`git diff --check` 通过。无新依赖；package.json 仅新增开通命令。
- 本机 `db:setup` 成功同步新增表，seed 不写密码。临时 SQLite 中运行交互式开通命令成功，两次密码输入均不回显；非交互管道被拒绝。
- 使用生产构建的本地测试服务和独立合成数据库，在浏览器验收错误密码拒绝、登录、页面刷新保留会话、修改本人需求成功、退出后修改被 UNAUTHENTICATED 拒绝。没有使用真实客户账号/密码或改写开发库业务数据。
- 新增密码存储和限频表为加法变更；同源/安全连接、输入上限、账号失败限频、密码计算并发限制、验证后角色/凭证变化、签发回滚和退出存储失败均有测试。旧版全局限频已按反馈移除。
