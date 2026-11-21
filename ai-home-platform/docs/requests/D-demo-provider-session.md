# D：固定服务方的演示登录与事务会话

日期：2026-11-14 · 本次基线：B 的 `feature/B-quote-demo-session`（3a290ac，PR #74）· 状态：演示登录及报价 POST 已接通，D 补齐公开路由回归测试与说明

## 原因与边界

显式开启的演示登录只使用服务端预设的 `demo-provider-account` → `provider-a`，不接受客户端 userId、role 或 providerId。它不是实名、密码或生产登录。角色导航不产生会话。B 已将演示 reader 接入报价 POST，D 本次修正之前“有效 cookie 仍返回 401”的测试及文档。

## 公共协议与配置

- 服务端 `DEMO_AUTH_ENABLED=true` 才开放；默认关闭。关闭期间 reader 拒绝所有演示 cookie。
- `POST /api/auth/demo-provider`：输入 `DemoProviderLoginInput`，仅 `{ action: "login_demo" }`；成功返回 `envelope(DemoProviderSession)` 并设置 HttpOnly、SameSite=Strict、Path=/ 的 cookie，HTTPS 使用 Secure。响应一律 `meta.source: mock`。
- `GET`：返回 `disabled`、`signed_out` 或 `signed_in`；登录态包含固定服务方身份与 expiresAt，均明确 demo 标识。响应不缓存，不返回令牌。
- `DELETE`：同源退出，删除数据库会话并清除 cookie，关闭模式时仍允许撤销。POST/DELETE 的 Origin 必须与请求协议及 Host 一致，兼容 NextURL 对 loopback 的规范化，不信任转发主机头；跨站和缺少 Origin 返回 403。登录坏输入返回 400，登录未开启返回 403，账号未准备/数据库异常返回 503。
- Cookie 是服务端生成的 256 位随机不透明令牌，数据库仅存 SHA-256 摘要，30 分钟绝对过期；重新登录轮换并撤销当前会话。持久化支持进程重启后读取，不依赖内存 Map 或浏览器存储。
- Prisma 增加 DemoProviderSession，保存摘要、userId、绑定 providerId、createdAt、expiresAt。种子增加固定账号，不覆盖既有账号/绑定。

## B 的接入

`requireProviderIdentity(request)` 的默认 reader 接入演示 cookie；未开启或无有效 cookie 仍返回 401。`server-auth.ts` 同时导出 `readDemoVerifiedSession(request, tx)`，可直接作为报价事务的 reader：必须传入当前 tx，重新检查会话存在、过期、账户角色和绑定。换绑、删除、退出后的会话不可重放。

PR #74 将报价 POST 处理器的 `QuoteSubmissionAuth.readSession` 与 `readTransactionSession` 默认值都改为 `readDemoVerifiedSession`，事务验证使用内核传入的当前 tx。开启演示认证并准备固定账号后，同源有效 cookie、合法输入和幂等键可给非演示、published 的数据库需求报价：首次返回 `201 envelope(Quote)`，同键同摘要且当前授权有效时重放原报价返回 `200`；两者均为 `ok: true`、`meta.source: mock`。

首次提交实际写入一条报价及一条幂等回执，重放不新增记录；匿名、关闭、过期、退出或绑定失效仍返回 401，状态及幂等冲突沿用原协议。数据库落库不等于真实身份验证或业主已收到报价，不能将 mock 解释为“没有保存”。D 在 PR #80 中更新了测试及文档，B 的路由/内核改动属于 PR #74。报价读取规则见 `D-quote-read-protocol.md`；公开 GET 接线和真实业主登录仍未实现。

演示身份可以给 live 需求报价，因此历史报价不能仅凭需求来源标 live。D 已按 `D-quote-source.md` 增加默认 mock 的持久化 `Quote.source`、兼容 DTO 及来源校验/汇总工具；历史回填和新演示记录均保守保存 mock。B 的首次/重放 DTO 与 GET 来源适配仍待接入，公开 POST 暂统一保守标 mock。

`server-auth.ts` 及演示会话实现纳入客户端传递导入检查。B 仅通过已有 server-auth 服务端入口使用适配器；UI 只调用公共 HTTP 接口。

## 验收

全局入口明确“演示服务方登录”；登录、刷新、过期和退出后的 UI 反映接口状态。隔离 SQLite 验证登录令牌不明文落库、失效/伪造/换绑拒绝、同事务可见及现有报价内核可用。所有合成测试数据只进入临时数据库；不得提交 .env、数据库或令牌。

`tests/D-demo-provider-session.test.ts` 通过真实演示登录处理器签发 cookie，再在独立进程调用公开 POST：无 cookie 为 401 且无写入；有效 cookie 为 201/ok/mock，报价和回执各增一条且关联相同报价 ID；断开 Prisma 后重新调用同键同内容，返回 200/ok/mock 和完全相同报价，记录数量保持不变。响应使用公共 `envelope(Quote)` 校验，没有注入放行身份。本次没有浏览器手工验收。
