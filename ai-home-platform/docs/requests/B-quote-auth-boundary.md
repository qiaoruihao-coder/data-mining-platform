# B → D：补齐报价认证模块的服务端导入边界

- 当前状态：已由 D 的 PR #46 修复，B 的 PR #42 已合入；下文保留原请求与验收范围。

- 基线：PR #36 已提供 `src/lib/server-auth.ts`，但 `scripts/check-boundaries.mjs` 只为报价模块放行了 demand.ts，没有允许导入 server-auth.ts。
- 影响：B 按交接调用 requireProviderIdentity 时，检查会报告 `src/lib/quote-engine/submit-request.ts -> src/lib/server-auth.ts`。本次未修改或绕过检查脚本。

## 请 D 修改

1. 精确允许 `src/app/api/quote/`、`src/lib/quote-engine/` 的服务端模块导入 `src/lib/server-auth.ts`，包括 requireProviderIdentity、providerIdentityFailureResponse 和 VerifiedSessionReader 类型。
2. 不把 server-auth 加入向所有页面开放的 shared 白名单；保留页面、组件、features 客户端模块的禁止导入规则。同步测试允许服务端路径、拒绝客户端路径。
3. 明确响应优先级并同步 docs/API.md：认证失败先返回 401/403，不消费请求体或查需求；已验证服务方通过输入、需求检查后，写入未实现仍为 501。当前默认适配器无真实会话，因此真实 HTTP POST 返回 401，而不是 501；两者都不是提交成功。

## B 已准备的接入

- `handleQuoteSubmission` 先调用 D 的 requireProviderIdentity，失败原样返回；服务端可注入已验证会话读取器用于后续认证接入和测试，公开 POST 路由不暴露该参数。
- 通过身份后使用公共提交契约和现有整数计价，调用 D 的 findDemand 精确读取需求；无需求 404、非 published 409、异常或错位 ID 503。
- 所有条件通过仍返回 501；未生成报价 ID、未写入、未使用演示身份，没有真实报价成功路径。现有 GET 仍是 mock。
- 本次仅接入身份与状态预检，不代表完成细粒度授权、并发状态保护、幂等或原子写入。后续真正写入时需在事务内再次核验状态和授权，不能依赖较早的预检结果。
- 测试注入的会话与需求均为合成数据，不是新增真实登录适配器。原草稿阻塞已解除；真实认证、幂等及公开写入的后续依赖见 B-quote-idempotency.md。
