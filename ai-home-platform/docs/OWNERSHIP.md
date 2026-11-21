# 唯一文件归属表
沿用总方案的四人职责，解决其中重复标注。**匹配/报价页虽然在 owner 下，专归 B。**
共享文件由 D 修改，A/B/C 可读取和复用，但不得自行改写。不要四个 AI 同时改全局文件。

| 角色 | 可修改路径 |
|---|---|
| A | src/app/owner/**（排除 matches、quotes）；ChatWindow、DemandCard、GanttChart 组件；src/features/a/**；tests/A-*；docs/tasks/A.md |
| B | src/app/owner/matches/**、owner/quotes/**；api/match/**、api/quote/**；lib/match.ts、lib/quote-engine.ts 及同名子目录；ProviderCard、QuoteTable 组件；src/features/b/**；tests/B-*；docs/tasks/B.md |
| C | src/app/provider/**、src/app/admin/**；StatusBadge 组件；src/features/c/**；tests/C-*；docs/tasks/C.md |
| D | 其他所有路径：contracts、其余 API、Prisma、LLM、mock-data、api-client、共享 ui、layout、globals.css、依赖、CI、文档等 |

各角色还可在 docs/requests/ 下新建以自身字母加连字符开头的变更请求。
精确可执行规则见 scripts/ownership.mjs。不要修改检查脚本来让越界改动通过。

## 三个交接点
- A 的需求澄清界面 ↔ D 的 POST /api/demand/chat 与 POST /api/demand。
- B 的匹配/报价接口 ↔ D 的需求/服务方数据、AI 封装；C 的报价表单调用 B 接口。
- A 的施工/付款页、C 的工单页 ↔ D 的 schedule/payment/ticket 接口。

## 共享变更流程
1. A/B/C 写 docs/requests/角色-主题.md，描述字段、类型、必填性、示例和受影响模块。
2. D 先更新契约、mock、数据库/接口适配和测试，单独提交 PR。
3. 合并后其他人同步 main，再开发调用方。过渡期尽量加可选字段，避免直接删除旧字段。
4. D 集成不等于替所有人重写业务目录；跨角色修复交给文件负责人。

## 新增组件
角色私有组件放 src/features/a|b|c/，避免多人争抢 components/ui。
模块内样式使用 Tailwind 或 CSS Module；全局色板和导航由 D 维护。
