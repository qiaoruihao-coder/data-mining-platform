# B → D：放行报价幂等与授权基础设施的服务端导入

基线：PR #57 已冻结协议并提供工具，但 `scripts/check-boundaries.mjs` 尚未允许 B 导入 `src/lib/idempotency.ts`、`src/lib/quote-policy.ts`。

## 请求 D 的精确修改

- 允许 `src/app/api/quote/`、`src/lib/quote-engine/`（及现有同名入口）服务端模块导入上述两文件，补充边界测试；不要加入面向全部页面的 shared 白名单，客户端仍不能直接引用。
- 当前报错为 `src/lib/quote-engine/transaction.ts -> src/lib/idempotency.ts` 和 `src/lib/quote-engine/transaction.ts -> src/lib/quote-policy.ts`。B 未修改或绕过检查脚本。
- 请明确已成交/完成需求的历史回执读取权限：当前唯一授权工具 authorizeProviderQuote 仅允许 published，B 暂对新建和重放都执行它，非 published 重放返回 409，不扩大权限。如需重放历史回执，请 D 提供独立读取授权及测试。

## B 已实现，可供审阅

- 使用 readIdempotencyKey、hashQuoteSubmission 和两个授权函数；事务中重读账户绑定、服务方及需求。首次返回内部 `{ quote, replayed: false }`，同键同摘要返回原报价及 `replayed: true`，供未来路由分别映射 201/200；同键不同摘要抛 409/IDEMPOTENCY_CONFLICT。
- 报价和 QuoteSubmissionReceipt 在同一个 Serializable 事务中提交。采用 D 的 DatabaseMoney/DatabaseInt 校验持久化范围；Quote 输出校验失败或回执插入失败均回滚。
- P2034/P2002 最多执行三次完整事务，每次重新认证；其他错误向调用方抛出，不对未知提交结果自动重试或断言未保存。
- 已用两个独立 Prisma 客户端连接临时 SQLite，验证同键并发只产生一份报价和回执；另覆盖重连重放、内容冲突、不同服务方隔离、账户换绑、范围校验及整体回滚。
- 本地已运行 db:setup 同步 PR #57 的结构；集成测试使用独立临时数据库和合成会话，不是实际登录。

导入边界修复前保持草稿。公开 POST 尚未调用此内核，未登录仍为 401、预检通过仍为 501；GET 报价仍是 mock。真实会话、公开路由和 C/A/B 查询闭环仍未接通。
