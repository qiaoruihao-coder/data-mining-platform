# D：匹配目录读取边界与冒烟时间断言修复

2026-11-14，修复匹配服务端读取目录时被共享边界拦截、冒烟时间比较偶发误报的问题。

## 变更请求与影响

- `scripts/check-boundaries.mjs`：允许 `src/lib/match/` 和 `src/app/api/match/` 的服务端代码读取 `src/lib/provider-directory.ts`。D 的基础设施与 API 仍可读取；页面、UI 和其他业务目录不因此取得权限。任何被 `use client` 直接或间接引用的代码均不得读取该适配器，包含静态导入、重导出和字符串动态导入。
- `tests/D-boundaries.test.ts`：覆盖上述允许与拒绝规则，并用隔离目录验证扫描器的客户端可达性检查。只新增精确的只读例外，不改变文件归属规则，不修改 B 的业务实现。
- `scripts/smoke-reviews.ts`、`scripts/smoke-inspection-images.ts`：保留公共契约解析、必需结果时间与合法时间检查，去掉服务端结果时间与冒烟进程 `Date.now()` 的严格区间比较；不改本地轮询超时或业务时间规则。
- `README.md`：明确 seed 只补缺失记录，已有演示报价不会被覆盖；提供全新隔离数据库的演示命令，保留原数据库和 `.env`，并区分固定公开报价页直接读取代码样例的行为。

不新增公共字段、接口、依赖或数据库 schema。`readProviderDirectory` 继续复用 `src/contracts` 的 Provider 与成功/失败信封；基础资料和档期仍为 mock，评价汇总按所选来源区分。真实照片分析仍为 501，不能作为分析成功。

## 交接

B 在本 PR 合入后同步 main，再从匹配服务端目录调用现有 `readProviderDirectory`；浏览器仍通过 `/api/provider` 或 B 的匹配 HTTP 接口读取，不能导入适配器。B 的匹配排序与页面接线由 B 完成。

固定公开入口 `/owner/quotes/demo-demand` 使用当前代码样例，无需覆盖旧库报价。数据库演示需使用新隔离库并执行 `db:setup`；旧库仅执行 `db:seed` 不会更新 quote-a/quote-b，且 seed 不会给 demo-owner 创建可登录密码。受保护报价仍须遵循已有业主登录、本人需求和服务方提交流程。

## 验收

实际验证（2026-11-14）：

- 边界专项 `node --import tsx --test tests/D-boundaries.test.ts`：7/7 通过，包含匹配/API 两个入口、D 共享文件中转，以及直接/间接客户端导入的拒绝。
- `npm.cmd run check`：900/900 通过，lint、typecheck、测试与 boundaries 全部成功。
- `npm.cmd run build`：通过。
- `npm.cmd run scope -- --role D --base origin/main`：通过，6 个本任务文件；`git diff --check` 通过。
- 使用 README 的随机新库名命令执行 `npm.cmd run db:setup` 成功，原数据库与 `.env` 保留；随后 `node scripts/run-production-smoke.mjs` 通过，包括 13 页面、32 GET、13 POST 基础场景及照片、履约、评价/来源隔离链路，测试子进程已停止。

本轮使用合成账号/照片和明确 mock 的演示服务方、固定档期/报价/评价样例；上传及登录通过实际 HTTP 验证。live 来源报价仅为现有存储夹具，不代表生产服务方认证。B 的排序/展示接线、真实档期、真实照片分析及最终演示集成仍待后续，本次没有扩大这些能力。
