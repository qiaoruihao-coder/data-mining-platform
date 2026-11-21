# D：匹配需求读取权限与集成交接

日期：2026-11-14 · 基线：main 161efb9 · 状态：D 基础设施交付，B 的路由接线待完成。

## 具体变更申请

审计发现 `src/app/api/match/route.ts` 调用 `src/lib/match/data.ts`，后者直接通过 `findDemand(id)` 按 ID 读取数据库。该链路不校验 cookie、需求发布状态或归属；匹配理由、分数和是否有候选可能透露未公开需求的属性。路由也未拒绝未知查询参数。当前页面通过 `/api/demand/[id]` 与 `/api/provider` 读取后计算匹配，已有需求读取权限检查；这不会保护独立的 `/api/match` 入口。

本轮由 D 增加 `src/lib/matching-demand.ts` 服务端基础设施，复用 `DemandIdParams`、`Demand` 和统一信封，不新增 DTO、数据库字段、依赖或环境变量。仅允许匹配 API、`src/lib/match/` 和 D 服务端导入；客户端直接或间接导入仍拒绝。角色文件归属检查不变，B 的路由、数据加载器和页面保持由 B 维护。

## 读取规则与验收

- 只接受 GET/HEAD，无参数或唯一非空 `demandId`；未知键、重复键和纯空白 ID 为 400/VALIDATION_ERROR。ID 原样精确匹配，不 trim 后选中其他记录。
- 无参数使用代码内固定 `demoDemand`，来源 mock；显式 ID（包括 `demo-demand`）必须查询实际数据库，不能缺失时回退固定样例。显式 demo 也受下述发布状态/归属限制。
- 与公开需求详情一致，published 可公开用于匹配；其他状态仅当前所属业主。服务方身份或已有接单关系不授予未公开需求的匹配读取权限。已公开不代表报价、接单或履约记录公开。
- 如携带业主 cookie，必须在 Serializable 事务内验证会话摘要、有效期、撤销和当前角色；坏/重复/失效凭证为 401，角色改变为 403，即使无参数演示也不能回退匿名。有效业主 cookie 优先；仅服务方 cookie 按公开范围读取，不转换为业主。
- 同一事务执行按 `id + published/ownerId` 过滤的 SQL、范围复核和公共 Demand 输出校验；非公开他人需求与不存在需求同为 404/DEMAND_NOT_FOUND。数据库、事务或坏数据为 503/DATABASE_UNAVAILABLE，不回退 mock 或成功空态。
- 返回需求信封只含公共字段，保留 mock/live，不含 ownerId、会话和其他内部数据。所有 HTTP 成功/失败必须使用 `Cache-Control: private, no-store`、`Vary: Cookie`。

## B 的后续接线

从 `@/lib/matching-demand` 导入 `readMatchingDemand`、`MatchingDemandAccessError`、`matchingDemandFailureResponse`、`MATCHING_DEMAND_RESPONSE_HEADERS`。

`readMatchingDemand(request)` 返回经过授权的 `envelope(Demand)`，自行解析 request 的查询参数并在内部事务完成需求读取。B 将原始 Request 传入加载器，移除匹配入口对无权限检查 `findDemand` 的调用，不另做查库或回退。返回之后再调用现有 `readProviderDirectory()` 和 B 的 `matchProviders(demand.data, directory.data)`；只有两者来源均 live 才能标整体 live。

路由捕获 `MatchingDemandAccessError` 时返回 `matchingDemandFailureResponse(error)`；目录错误继续映射 503/PROVIDER_UNAVAILABLE，其他异常映射中性 503，均附上述缓存头。读取器拒绝时不得继续加载目录或计算匹配。保留现有匹配权重、档期与评价排序。

B 需增加 API 验收：匿名仅 published；所属业主读取本人全部状态；匿名/他人/服务方读非公开及不存在均同一 404；失效/重复业主凭证 401、角色变化 403；未知参数 400；显式 demo 数据库缺失仍 404。更新现有 `tests/B-match-demand-api.test.ts` 的数据库替身以支持事务和授权过滤，不降低断言。D 在 B 接线合入后补生产 HTTP 权限冒烟与浏览器联验。

**本 PR 不改变线上 `/api/match` 行为；在 B 完成接线前，匹配读取权限缺口仍存在，不能宣称平台已完成数据隔离。**

## AI 与演示决定

已读取 `A-ai-live.md`。本轮暂不启用真实需求澄清供应商：现有网关有 live 代码路径，但尚未完成真实供应商配置及外部调用验收。README 明确“AI 澄清默认是 mock”；受控响应测试只验证协议，不证明已接通真实模型。后续启用必须按 A 的完整草稿、缺失字段、非法 JSON、无模拟降级及来源要求单独验收。

固定档期覆盖 2026-11-15 至 2026-12-31；答辩若晚于 2026-12-31，需由 D 更新固定样例并联合 B/C 复核来源和过期排序规则。当前未提供更晚日期，保留既有范围，不自动延长或把演示窗口视为服务承诺。

## 实际验证

- `npx tsx --test tests/D-matching-demand.test.ts tests/D-boundaries.test.ts`：21/21 通过。
- `npm run check`：lint、TypeScript、973/973 测试与导入边界全部通过。
- `npm run build`：生产构建通过。
- `npm run scope -- --role D --base origin/main`：通过，8 个文件均归 D；未修改 B/A/C 业务目录或归属检查规则。
- `node scripts/run-production-smoke.mjs`：全新隔离测试库通过；13 页面、32 个 GET 场景、13 个 POST 场景，以及照片、履约→评价、评价汇总和履约历史读取链路通过；本次测试服务已停止。

读取器测试使用隔离 SQLite、合成账号/需求和真实持久化会话。生产 HTTP 冒烟使用 AI_MODE=mock，验证现有路由回归；新读取器尚未接到 `/api/match`，因此不能将这些冒烟结果解释为匹配 HTTP 权限修复已生效。本机相关 LLM 配置均为空，本轮没有调用外部模型。无新增运行时 mock 数据，原有演示需求/目录/AI 来源继续保留；真实模型、B 权限接线及最终完整演示验收未完成。
