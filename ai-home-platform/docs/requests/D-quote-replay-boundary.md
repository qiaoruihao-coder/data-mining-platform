# D：报价服务端导入与历史回执重放边界

日期：2026-11-14 · 对应请求：`B-quote-idempotency-boundary.md`

## 变更理由与范围

B 的事务内核需要使用 D 的 `idempotency.ts` 和 `quote-policy.ts`。这两个模块只允许服务端使用，不能添加到全局 shared 白名单。

- 修改 `scripts/check-boundaries.mjs`：允许报价 API、报价引擎及 D 的服务端基础设施导入；页面、组件、其他角色业务目录禁止导入。
- 识别 `use client` 及其静态导入、重导出、字符串动态导入形成的依赖链；即使路径位于报价引擎目录，客户端可达时也禁止导入这两个模块。
- 补充 `tests/D-boundaries.test.ts`，覆盖放行、拒绝及实际扫描器的传递导入；不改文件所有权规则、不改 B 的业务文件。

## 当前重放决策

保持保守规则：首次写入和同键同摘要重放都必须在当前事务中通过身份、账号绑定和 `authorizeProviderQuote`。需求为 `contracted`、`in_progress`、`completed` 或 `draft` 时，重放也返回 `409 INVALID_STATE`，不返回历史报价，不新建或修改记录。这只表示当前操作被拒绝，不表示上一次提交未保存。

同一服务方同键不同摘要仍先返回 `409 IDEMPOTENCY_CONFLICT`；没有需求返回 `404 DEMAND_NOT_FOUND`；演示需求返回 `409 DEMO_DEMAND_READ_ONLY`。401/403 身份失败先于回执读取。历史记录保留，后续若开放历史读取，需要独立冻结读取权限和接口，不能通过放宽首次报价授权实现。

## 影响与验收

不新增 DTO、数据库字段或依赖。公共 API 文档和原幂等决策同步说明上述规则；D 授权测试覆盖所有需求状态。B 可保留当前事务处理顺序。公开报价写入和真实会话仍未接通，GET 报价仍为 mock。
