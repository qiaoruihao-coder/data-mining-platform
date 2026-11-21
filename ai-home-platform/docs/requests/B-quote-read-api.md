# B：业主报价读取 GET 接线

日期：2026-11-14。当前基线：main `d6255e1`，已包含 D 的 PR #76/#80/#81、B 的 PR #70/#74/#77。继续更新 PR #79；通过 merge 同步已发布分支以避免强推，`route.ts` 冲突按双方意图解决，保留动态授权 GET 和演示会话 POST。

## 已实现

`GET /api/quote?demandId=<精确 ID>` 通过 D 的 `server-auth` 导出调用 `parseQuoteQuery` 和 `authorizeOwnerQuoteRead`，组合已有 `readStoredQuoteComparison`。没有自建参数 DTO、固定业主、前端身份信任或授权快照。凭证、当前角色、需求归属、明细读取均在内核同一 Serializable 事务中执行。

- 无参数保留固定 mock；未知参数、重复、空或纯空白 ID 返回 400。非空 ID 原样查询，不 trim，不回退 demo-demand。
- 无效/缺失/过期/撤销会话 401，当前角色不符或有效演示服务方 403。本人所有需求状态均可读取 submitted/accepted；他人和不存在统一 404，文案一致。
- 已有需求无可比报价为 200 空数组；内核返回 null 也映射为上述 404。JSON、DTO、金额溢出、错位结果、数据库异常均为 503，不部分返回、不变成空成功或 mock。
- 成功返回公共 `envelope(Quote[])`，金额逐行重算，null 与零元分别保留；稳定 ID 顺序不表示最新版本、价格或质量排名。
- 当前创建报价在事务认证通过后显式写入服务端 `mock`，首次回执、重放及 GET 均通过 D 的 `parseStoredQuoteSource` 严格读取原库来源，并输出每条 `Quote.source`。POST 的 meta 使用该持久化来源；重放不因当前 reader 或账号变化改写历史来源。
- GET 使用 `summarizeQuoteSources` 汇总实际返回列表：需求和全部报价均 live 才 live，混合或未知需求来源为 mock，空列表沿用需求来源。数据库缺失/null/非法来源一律失败，不按兼容 DTO 的可选字段默认为 mock；POST 坏输出 500（首次在事务内回滚），GET 503。来源不进入客户端输入或幂等摘要。
- 路由 `force-dynamic`；成功、失败及无参数演示响应均使用 D 的 `Cache-Control: private, no-store` 和 `Vary: Cookie`。

本次完成 GET API 及报价创建/重放来源接线；页面仍调用无参数演示 GET，后续单独切换显式查询并处理业主认证失败和逐条来源展示。未修改 D/C/A 文件、公共契约、配置、依赖或 .env。按 D 指引备份本地 SQLite 后运行 `npm run db:setup` 成功；对比备份确认原有 13 条记录原字段保留，历史报价回填 mock，无数据丢失提示。

## 测试与限制

`tests/B-quote-read-api.test.ts` 在设置临时 DATABASE_URL 后加载默认公开 GET，不注入授权器。仅在测试中通过 D 内部签发函数为合成账户准备随机会话，读取使用实际数据库会话和授权实现。测试包含原子内核写入后重连，GET 读回同一 ID/金额/null、所有需求状态、跨业主隔离、精确 ID、会话变化、事务内撤销与回滚、数据损坏和故障映射。测试签发不代表密码或外部身份验证已实现，没有生成生产业主凭证或新增签发接口。

业主登录/注销入口仍未实现，当前浏览器没有正常取得业主会话的入口，匿名显式 GET 应返回 401。未进行浏览器登录闭环验收。无参数报价、服务方资料及演示身份提交仍为 mock；测试中显式 live 的持久化记录仅是合成夹具，不是生产认证。

定向命令：`node node_modules/tsx/dist/cli.mjs --test tests/B-quote-read-api.test.ts tests/B-quote-read.test.ts tests/B-quote-transaction.test.ts tests/B-quote-demo-session.test.ts`，56/56 通过。覆盖首次写 mock、真实演示 cookie 重连重放、严格坏来源回滚/拒绝、历史 mock/live 不改写、全 live/混合/演示/空列表及排除状态不影响汇总。

当前 `npm run check` 未通过：lint 无警告、类型通过，全量 467 项中 465 通过、2 失败（下述 D 旧断言及父测试）。未跳过任何测试。`npm run build`、单独 `npm run boundaries`、`npm run scope -- --role B --base origin/main`（整个 PR 为 11 个 B 文件）和 `git diff --check` 均通过。

## D 的测试及文档交接

合并前请 D 更新 `tests/D-owner-quote-read-auth.test.ts:248`：该用例通过当前报价内核创建合成服务方报价，来源按新规则保存 mock，因此 `result?.response.meta.source` 期望应从 live 改为 mock，并建议断言 `result?.response.data[0].source === "mock"`。该用例的 ID/金额/null/状态与授权断言保持不变。当前失败验证了来源修正已生效，不能为通过旧测试把演示报价重新标 live。此文件属于 D，本次没有修改。

请 D 在合入时同步公共文档“GET 尚未接线”和“来源适配待实现”的状态：服务端来源漏洞已按 PR #81 的工具接线，页面和业主登录入口仍待完成。PR #74 的旧测试修复已随 #80 合入，不再是本 PR 的阻塞；上面的业主读取测试是另一条需要同步的新断言。
