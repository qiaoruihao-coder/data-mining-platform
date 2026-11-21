# B：演示会话接入报价提交与后续交接

日期：2026-11-14。基线：main `2446694`（PR #69 已合入）。

## 本次完成

- 默认 `handleQuoteSubmission` 的 `readSession`、`readTransactionSession` 均使用 D 从 `server-auth` 导出的 `readDemoVerifiedSession`；事务内重新读取凭证和当前绑定，使用内核传入的 tx。
- 同源有效演示会话首次提交返回 `201 envelope(Quote)`，同键同摘要重放返回 `200` 和原报价。两种回执均为 `meta.source: mock`，尽管报价及幂等回执已实际写入 SQLite。来源表示演示身份，不能把落库解释为生产认证。
- 当前处理器只开放演示认证，成功来源统一保守标为 mock，包括测试注入 reader 的调用；未来生产认证接入必须同时明确来源协议，不能仅替换 reader 后直接改成 live。请求体不接受 source/meta/身份等额外字段。
- 401/403、幂等冲突、金额计算、需求状态、原子写入和结果未知语义沿用已有协议；不修改公共类型、依赖、配置或数据库 schema。

## 可验收方式及实际检查

维护者按 D 的说明在本地准备数据库和演示账号、显式设置 `DEMO_AUTH_ENABLED=true` 并重启后，可通过导航中的演示服务方登录，对非 demo-demand 的 published 数据库需求提交报价。首次 201/mock，同键同体重试 200/mock；退出或关闭演示后 401。演示需求仍只读；真实业主读取尚未开放。

本次没有修改已有 .env 或开发数据库；只生成已合入 schema 对应的 Prisma Client。集成测试通过 D 登录处理器签发真实演示 cookie，再调用默认公开 POST，在临时 SQLite 中验证；不注入假身份、不输出令牌。未进行浏览器手工验收。

- 定向测试：`node node_modules/tsx/dist/cli.mjs --test tests/B-quote-demo-session.test.ts tests/B-quote-auth.test.ts tests/B-quote-transaction.test.ts`，39/39 通过。涵盖 201/200/mock、重连后幂等、整数分/null/零元、关闭/伪造/过期/退出/解绑、同源校验、输入来源拒绝、预检后身份变化、同 tx 会话撤销和回滚。
- `npm run check`：lint/typecheck 通过；全量 418 项，416 通过、2 失败（下述 D 旧断言及其父测试）。因此 check 整体失败，不能宣称全绿。lint 有 A 模块两个既有 Hooks 警告。
- `npm run boundaries`：单独运行通过，check 因测试失败未执行末尾命令。
- `npm run build`：通过；仅上述两个既有 Hooks 警告。
- `npm run scope -- --role B --base origin/main`：通过，5 个文件均在 B 范围内。`git diff --check` 通过。

## 请 D 更新现有集成测试及接口说明（合并前阻塞）

`tests/D-demo-provider-session.test.ts` 最后一项“独立进程确认演示会话有效，但报价处理器尚未接入 reader，返回 401 且不写入”已不符合新要求。请由 D 更新标题、子进程采集结果和断言：

- 保留 `sessionValid: true`、`providerId: DEMO_PROVIDER_ID`、`anonymous: 401`。
- 有效 cookie 的 `withDemoCookie` 从 401 改为 201，`ok` 从 false 改为 true，移除 `code: UNAUTHENTICATED`；`added`、`receiptsAdded` 从 0 改为 1。
- 采集并断言 `meta.source === "mock"`；建议补充同键重放 200、原报价 ID 和记录数不变。本次 B 测试已覆盖这些行为，但不能替代修复 D 的旧断言。
- `docs/API.md` 和 `D-demo-provider-session.md` 中“公开 POST 仍未接入 reader/有效 cookie 返回 401”更新为上述新行为；无有效会话仍 401。B 不改写 D 文件，不跳过或删除测试。

## GET 尚缺依赖及来源决策

遵循 `D-quote-read-protocol.md`：D 需先交付公共严格 `QuoteQuery`/DTO、事务内授权器及分类拒绝错误、可撤销的真实业主会话。当前只提供协议文字，演示服务方会话不能授权业主读取。上述依赖合入后 B 再将 PR #70 内核接到 GET/页面；目前 GET 仍是固定 mock，带 demandId 也不能视为数据库查询。

另请 D 解决来源冲突：当前读取规则及内核只按需求来源标记，演示身份却能对 live 需求写入 mock 报价。Quote 和 QuoteSubmissionReceipt 尚无来源字段，未来 GET 若仅沿用 demand.source，会把演示报价标为 live。请冻结并实现服务端持久化来源方案，例如 Quote 的必填 source（mock/live）、历史记录默认 mock、新写入由服务端认证决定；混合来源列表整体 mock，仅全部报价及需求均为 live 才为 live。字段是否公开到 Quote DTO、空列表来源和历史回填由 D 统一定案，B 再更新写入/读取适配。不得允许客户端指定来源，也不能只由当前读取者的身份猜测历史来源。

## C 的文案交接

`src/features/c/QuoteForm.tsx` 当前把 mock 回执描述为“模拟接口响应，不代表真实保存或业主已收到”。此次 mock 明确表示演示身份，但记录确实落库。请 C 按冻结协议调整表述为“演示身份报价回执；不代表真实业务身份或业主已收到”，保留 mock 标识和提交不等于接单的提示。B 未修改 C 模块。
