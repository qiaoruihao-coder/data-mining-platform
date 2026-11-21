# B → D：报价查询与提交契约交接

- 申请角色：B
- D 处理状态：PR #57 已冻结持久化幂等、账户绑定、报价授权及数据库范围。B 已准备幂等事务内核，新增工具导入边界仍待 D 修复；真实登录和公开写入尚未接通。
- 用户场景：C 提交服务方报价后，A/B 按同一 demandId 查看已提交报价；不能由客户端冒充服务方或决定合计金额。
- 共享文件：src/contracts/index.ts、docs/API.md、D 的鉴权/数据库/查询基础设施、共享 mock 和契约测试。由 D 修改，B 本 PR 不改这些文件。

## 2026-11-14：提交校验与计价

- B 的 `src/lib/quote-engine/submission.ts` 使用公共 QuoteSubmissionInput 校验，将数量的规范十进制字符串拆分并补足三位小数，构造 BigInt 千分位数量 q。已知单价 p 使用 `(q * p + 500n) / 1000n` 逐行四舍五入到分，再用 BigInt 汇总；每行和合计先检查安全整数上限，之后才转回 number 并通过公共 Money 校验。
- PR #28 的浮点乘法已按 PR #31 和 C-quote-rounding.md 修正。回归样例：0.144/0.145/0.146 × 100 分分别为 14/15/15 分；1.004/1.005/1.006 × 100 分分别为 100/101/101 分；两行 0.145 × 100 分分别为 15 分、合计 30 分。测试同时覆盖零元、null、数量上下限、大整数中间值及单行/累计溢出。
- 未知单价保持 null，行金额也为 null，不参与已知小计。零元明确保留为 0。同名但不同 code 的未知项目在 pendingItems 中保留多个名称条目。
- 计价函数只返回现有 Quote 的需求、明细、工期、已知小计和待确认字段；不生成身份、报价 ID、submitted 状态或成功信封，不查询或写入数据库。
- POST /api/quote 先检查服务端身份：无已验证会话返回 401/UNAUTHENTICATED，非服务方或无服务方绑定返回 403/FORBIDDEN，不解析请求体或查需求。当前默认适配器无真实会话，因此实际 HTTP 请求返回 401。
- 认证后非法 JSON 返回 400/INVALID_JSON；公共输入校验失败、客户端伪造字段或计算溢出返回 400/VALIDATION_ERROR。再通过 findDemand 查询，无需求 404/DEMAND_NOT_FOUND，非 published 409/INVALID_STATE，查询失败或错位 ID 503/DATABASE_UNAVAILABLE。全部通过仍为 501/NOT_IMPLEMENTED，不返回报价或成功信封，不写库。
- server-auth 的导入已由 D 的 PR #46 放行。预检不替代事务内授权和状态核验；幂等、事务内真实认证及数据库约束的具体请求见 B-quote-idempotency.md。
- GET /api/quote、现有报价展示和历史明细计算规则保持原行为；不会用新输入计价规则补齐历史报价的 null 金额。页面及 C 的提交表单本次未修改。
- 请 D 在 docs/API.md 中同步上述校验行为；公共字段和成功响应形状没有新增。

## 2026-11-14：单次原子写入内核（尚未接入公开 POST）

`src/lib/quote-engine/transaction.ts` 的 createQuoteAtomically 使用现有 Prisma Serializable 事务，要求服务端提供事务会话读取器。事务内重新调用 D 的身份入口、核对预检的用户和服务方是否仍一致，并读取当前账户角色、服务方是否存在；使用 `findDemand(id, tx)` 重读需求，拒绝不存在、非 published 和模拟需求，再持久化服务端整数计价的明细、合计与 submitted 状态。返回 DTO 的校验也在事务内，失败回滚，提交完成后才返回。

上述为 PR #50 的原子核心阶段；PR #57 后已接入 readIdempotencyKey、hashQuoteSubmission、authorizeProviderAccount、authorizeProviderQuote。报价与回执在同一个 Serializable 事务提交，同键重放返回原报价，不同内容冲突；DatabaseMoney/DatabaseInt 在写入前校验。当前授权要求新建及重放均为 live、published 需求，历史回执读取规则待 D 明确。

内核返回 `{ quote, replayed }`，供后续路由映射 201/200，尚未替换公开路由的 501。测试用隔离临时 SQLite 验证插入、重放、两个客户端并发及回滚，会话和数据均为合成夹具。公开 POST 仍为未登录 401、预检通过 501，GET 仍是 mock。新增模块的边界许可和后续接通限制见 B-quote-idempotency-boundary.md。

## 已交付的报价读取与对比

B 的报价页通过已开放的 GET /api/demand/[id] 验证当前需求，再调用现有无参数 GET /api/quote，仅展示同一 demandId 的 submitted/accepted 报价；有报价时通过 GET /api/provider 取得服务方资料。三类数据分别标来源。GET /api/quote 继续沿用演示数据和 envelope(Quote[])；本次不新增查询参数协议，不接入写入。

逐条需求来源接入：需求标签只读取公共 Demand.source；缺失时显示“未知（接口未提供逐条来源）”，不按整体信封、需求 ID 或文字内容推测。整体 mock 不把逐条 live 需求改标为模拟；逐条 mock 也不会被整体 live 覆盖。缺失来源时不把合成结果升级为全 live，页面明确展示未知。报价及服务方继续使用各自响应来源，有报价和空报价都遵守同一规则。

2026-11-14 页面接入：已保存的新需求可进入报价页，当前固定 mock 报价与其不匹配时显示“暂无属于这份需求的模拟报价”，不把它描述成真实报价不存在。需求 404 展示未找到，501/503/网络及契约错误展示失败且可重试，不回退默认需求或空成功。页面提供刷新，切换 ID 或刷新时立即隐藏旧结果；未知需求的页面外壳为 HTTP 200，客户端详情接口的 404 驱动未找到提示。匹配页恢复带当前 ID 的报价入口。

已知费用按现有 QuoteItem.amountCents 累加；null 不推算成零或自动用数量乘单价填充。amountCents 或 unitPriceCents 为 null 的项目，以及报价中声明的额外 pendingItems，均保留为待确认。空明细不构成完整报价；已知费用不能直接作为最终总价或最低价。

待确认明细按现有 items[].code 区分，不按名称合并。同名不同编号的两项在公共 pendingItems 名称数组中保留两个条目，页面从明细读取编号并分别展示。重复汇总不会将名称数组再次计为额外项目。现有 pendingItems 中无法对应待确认明细的名称继续保留；该字段没有编号，不能可靠区分同名额外费用与明细，仍需 D 在后续契约中明确关联方式。本次未修改公共字段。

## 请求 D 确认并合入的字段与行为

1. 已完成：公共 QuoteSubmissionInput 和 DTO，含 demandId、1–20 项 items、正安全整数 estimatedDays；行 code 唯一，quantity 为正数、至多三位小数且不超过 1,000,000，金额用安全整数分或 null。具体限制直接使用公共 Schema，不复制替代 DTO。
2. 输入已禁止 providerId、amountCents、knownTotalCents、pendingItems、status 等服务端字段。D 已提供 requireProviderIdentity、401/403 规则和导入许可；仍需提供真实验证签名、会话过期、账户绑定和数据访问范围的事务会话适配器，不能信任客户端身份字段或角色导航。
3. 已完成：按 PR #31 的逐行整数舍入规则实现提交计价和安全整数校验，与 C 的边界样例一致；该规则仅用于新的提交输入，不推算历史报价未列明的金额。
4. 按 D 的交接，B 已准备事务内身份/需求复核、幂等及原子写入，使用 PR #57 的唯一回执约束。公开路由尚未调用；请 D 放行新增模块导入、提供真实事务会话并明确历史回执读取规则。写入开放后只在事务提交完成时返回成功回执，失败不得残留部分数据，未知提交结果不能冒充明确失败。
5. 报价查询仍待确定协议，建议 GET /api/quote?demandId=... 返回 envelope(Quote[])；已知需求暂无报价时为 []，未知需求 404，非法参数 400，无权限按 D 的统一约定处理。业主只读 submitted/accepted，草稿和已拒绝报价不进入当前对比。D 已允许 quote API/quote-engine 复用 findDemand，B 本次已准备调用，不复制查询逻辑。
6. 与已有 B-demand-query.md 一并明确需求和服务方名称查询的来源。真实查询失败不得回退为模拟成功；仅完整数据链路接通后标 live。

## 已冻结输入示例（未登录 401，已认证且通过需求校验后仍为 501，不会写入）

```json
{
  "demandId": "demo-demand",
  "estimatedDays": 25,
  "items": [
    {"code":"bathroom","name":"浴室改造套餐","unit":"job","quantity":1,"unitPriceCents":1200000,"note":"范围需现场确认"},
    {"code":"haul","name":"垃圾清运","unit":"job","quantity":1,"unitPriceCents":null,"note":"待补充"}
  ]
}
```

本例计价结果为 knownTotalCents=1200000，保留清运的 null 单价/金额及 pendingItems=["垃圾清运"]；当前不会返回这些结果作为提交成功。后续成功响应复用 envelope(Quote)：服务端生成 id、providerId 和 submitted 状态，来源必须反映实际持久化和查询链路。

## 兼容与验收

- 保留现有 Quote 输出字段和无参数演示入口；先合入公共输入类型和服务，再由 B/C 适配各自模块。
- 伪造 providerId、金额合计或状态的请求被拒绝，合法身份只能给有权限的需求报价。
- 提交含未知费用的报价后，C 得到真实成功；A/B 读取相同需求时显示相同明细、已知合计与待确认项。
- 不同需求的报价不混入；空结果、404、权限失败和服务器失败分别处理。
- POST /api/quote 默认未登录返回 401，认证及其他校验通过仍返回 501/ok:false，页面均不能显示提交成功。
- 档期排序、单位不一致/缺项诊断等 P1 功能不在本次范围。
