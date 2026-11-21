# D：报价幂等、事务身份与写入授权决策

发起人：D · 日期：2026-11-14 · 关联：`docs/requests/B-quote-idempotency.md`

本文件冻结报价幂等、事务身份与写入授权协议。PR #74 已将公开 `POST /api/quote` 的预检及事务会话 reader 接入演示认证；同源有效演示 cookie 的合法首次提交返回 201/mock，同键同摘要且当前授权有效时返回 200/mock 和原报价，不重复写入。无有效会话仍返回 `401 UNAUTHENTICATED`。生产认证与公开业主读取未开放；持久化报价来源的后续决策见 `D-quote-source.md`。

## 幂等键与回执

- `POST /api/quote` 写入开放后必须携带 `Idempotency-Key` 请求头。值使用公共 `IdempotencyKey` 校验：16–128 位 ASCII 字母、数字、`-` 或 `_`；缺失或非法返回 400。请求体不增加幂等字段。
- `src/lib/api-client.ts` 的 `apiPost` 支持可选 `headers`，调用方在一次提交和不确定结果的重试中复用同一键；修改输入后必须生成新键。
- Prisma 新增 `QuoteSubmissionReceipt`，保存 `providerId`、`idempotencyKey`、`requestHash`、`quoteId`、`createdAt`；`(providerId, idempotencyKey)` 唯一，`quoteId` 唯一并关联 `Quote`。回执和报价必须在同一 Serializable 事务中提交。
- `requestHash` 使用公共 `QuoteSubmissionInput` 规范化后的固定 JSON 做 SHA-256，保留明细顺序、`null` 与 `0` 的区别。摘要不能替代 `(providerId, key)` 唯一约束。
- 同一服务方、同一键、同一摘要且通过当前事务授权时重放原报价：首次写入 201，重放 200，均返回公共 `envelope(Quote)`；同一键不同摘要返回 409 `IDEMPOTENCY_CONFLICT`，不得覆盖旧报价。不同服务方使用同一键互不影响；不同键可创建新的报价版本，是否限制重复业务报价由后续报价状态协议另行冻结。

### 已签约或已完成需求的回执

当前采用保守规则：回执重放也调用 `authorizeProviderQuote`，必须是 `live`、`published`、非演示需求。已签约 `contracted`、施工中 `in_progress`、已完成 `completed` 和草稿 `draft` 的同摘要重放统一返回 `409 INVALID_STATE`，不返回历史报价，不新增或修改报价/回执。409 不表示历史提交未保存；已有回执继续保留，客户端应保留原键及原输入，不能自动换键重报。

事务处理顺序：重新认证并验证当前账号绑定 → 按当前服务方与键查询回执并检查摘要（不同摘要为 `409 IDEMPOTENCY_CONFLICT`）→ 重新读取需求（不存在为 `404 DEMAND_NOT_FOUND`）并检查当前报价授权 → 重放原记录或首次写入。身份失效返回 401，换绑/权限失败返回 403；演示或非 live 需求返回 `409 DEMO_DEMAND_READ_ONLY`。持有幂等键不能跳过这些检查。

历史幂等回执的 POST 重放仍受上述限制。业主比较列表的独立读取权限见 `D-quote-read-protocol.md`，允许业主读取本人签约后的已提交/已接受报价；不能据此放宽首次写入或 POST 重放的 published 限制。公开 GET 尚未接入该读取协议。

## 事务会话与账号绑定

- 事务内会话读取器使用 `(request, tx) => unknown | Promise<unknown>`，必须在同一 Prisma transaction client 上重新验证会话凭证、过期和撤销状态，并读取当前 `User`、`ServiceProvider` 记录；不能复用预检身份快照。D 的演示适配器使用随机令牌的数据库摘要验证凭证，可从 server-auth 导入 `readDemoVerifiedSession(request, tx)`；仅显式开启时可用，来源仍为 mock，详见 `D-demo-provider-session.md`。
- `User.providerId` 与 `ServiceProvider.account` 形成一对一绑定，账号角色必须是 `provider`，绑定的服务方记录必须存在，且数据库绑定必须与会话中的 `providerId` 一致。缺失、换绑、角色变化或服务方删除均返回 403。
- 认证适配器异常按未认证处理；默认适配器只接受显式开启且凭证有效的固定演示会话，否则返回未认证。回执重放也要在当前事务中复核读取权限，不能因持有幂等键绕过身份检查。

## 服务方报价权限

- 已验证且已绑定的服务方可以给 `source: live`、`status: published`、非 `demo-demand` 需求报价。
- `draft`、`contracted`、`in_progress`、`completed` 返回 409 `INVALID_STATE`；演示或来源不是 `live` 的需求返回 409 `DEMO_DEMAND_READ_ONLY`。
- 当前数据库没有服务区域关系，城市匹配只用于匹配排序，不作为写入授权条件。后续若增加服务区域或项目邀请关系，必须在事务授权函数中扩展，不能由客户端声明权限。

## 金额与失败语义

- Prisma SQLite `Int` 是有符号 32 位整数，写库字段的金额和工期必须落在 `[-2_147_483_648, 2_147_483_647]`；金额使用非负子范围。公共 `Money` 继续保留安全整数范围，`DatabaseInt`/`DatabaseMoney` 只在持久化边界校验，避免破坏现有预览和历史报价契约。
- `knownTotalCents`、每行 `amountCents` 和 `estimatedDays` 在事务写入前都必须通过数据库范围校验；超范围返回 400 `VALIDATION_ERROR`，不得让 Prisma/SQLite 异常决定 API 语义。
- 已明确识别的 P2034/P2002 数据库冲突在内核重试耗尽后返回 `503 DATABASE_UNAVAILABLE`；只表示本次冲突操作未完成，不证明此前同键提交未保存。其他无法可靠分类的异常（包括提交后连接丢失、数据库坏输出或响应构造失败）保守返回 `500 INTERNAL_ERROR`，不暴露内部异常，不自动重试。
- 结果未知时，客户端必须保留同一 `Idempotency-Key` 与原输入供核实/重试，服务端按回执查询结果处理，不能自动换键重发或宣称一定未保存。

## 接入边界

B 的处理器/内核已调用 `readIdempotencyKey`、`hashQuoteSubmission`、`authorizeProviderAccount` 和 `authorizeProviderQuote`，并将回执写入与报价写入放进同一事务。剩余接入是服务端预检和事务会话参数；演示 reader 已由 D 提供，B 使用演示身份时还必须把成功回执标为 mock。真实登录仍未实现。

`idempotency.ts` 与 `quote-policy.ts` 的导入只向报价 API、报价引擎和 D 服务端基础设施开放；页面、组件、其他角色业务目录及 `use client` 的传递依赖均禁止访问。变更和验收见 `D-quote-replay-boundary.md`。
