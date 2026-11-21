# B → D：匹配模块真实需求查询交接

- 申请角色：B
- 状态：D 在 PR #20 开放服务端复用边界；B 的匹配页面与 API 均已接入已保存需求，鉴权和真实服务方数据仍待 D 提供。
- 用户场景：业主从 A 的需求详情进入匹配页时，需要用同一个 demandId 获取对应需求与服务方，不能总显示 demo-demand。

## 2026-11-14：匹配 API 接入已保存需求
- GET /api/match 通过 src/lib/match/data.ts 复用 D 的 findDemand，不复制数据库查询逻辑。
- 不带 demandId 参数保留原固定演示入口，不查询数据库。显式 ID（包括 demo-demand）必须存在于数据库，按该需求实际城市及改造类型调用现有匹配规则。
- 成功响应继续为 envelope(Match[])。候选服务方仍来自共享固定 mock，因此即使需求已保存，整体 meta.source 也保持 mock；空匹配结果同样标 mock。
- 不存在的 ID 返回 404/DEMAND_NOT_FOUND；空、纯空白或重复 demandId 返回 400/VALIDATION_ERROR，并且不查询数据库。
- 读取异常、需求字段不符合契约或返回 ID 不一致时，返回 503/DATABASE_UNAVAILABLE，不泄露底层异常，不回退演示结果或空成功。非空 ID 按精确 ID 查询，不自行替换或修剪。
- 路由继续 force-dynamic，每次读取当前需求；更新需求会改变结果，删除后查询返回 404。
- 页面 /owner/matches/[id] 保留下述 HTTP 查询和逐项来源展示，不引入服务端数据库模块。
- 所有金额、对象、Match[] 和来源字段继续使用 src/contracts，不新增另一套 DTO。

## 2026-11-14：真实需求匹配页面

- 通过共享 apiGet 调用 GET /api/demand/[id] 和 GET /api/provider，分别使用 Demand、Provider[] 校验，再调用现有 matchProviders 规则。
- 实际需求的城市和改造类型参与过滤与排序，返回 ID 必须与当前需求一致；404 展示未找到，501/503/网络/契约错误展示失败并可重试，不回退列表或 demo-demand。
- 页面需求标签读取公共 Demand.source，与服务方响应来源分开展示；缺失逐条 source 时显示“未知（接口未提供逐条来源）”，不按 ID 或整体信封推测。整体响应含 mock 时仍保守标记；只有需求逐条来源及所有使用的响应来源都为 live 才标为全 live。当前 provider 接口仍为 mock，不表示真实服务方或真实 AI 已接通。
- 未知需求的页面外壳 HTTP 为 200，客户端读取需求接口得到 404 后展示未找到；GET /api/match 查询不存在的 ID 则直接返回 HTTP 404。
- 报价页已读取当前需求并在现有报价响应中按 ID 筛选，匹配页提供带当前 ID 的报价入口；固定模拟报价不会混入新需求。空模拟列表不表示真实报价不存在。报价真实查询及写入仍按 B-quote-submission.md 等待公共契约及基础设施。

## 服务端复用边界已开放

原请求为允许 B 的匹配服务端代码调用 `src/lib/demand.ts` 的 findDemand，同时保持页面/客户端边界。D 在 PR #20 中已允许 `src/lib/match/` 和 `src/app/api/match/` 导入该服务。B 本次只在 `src/lib/match/data.ts` 使用该入口，没有修改检查脚本、共享服务或 Prisma 配置。

请 D 将 docs/API.md 中 GET /api/match 的状态与参数说明同步为上面的实际行为，尤其是显式 demo-demand 也查数据库、缺失时返回 404、读取失败返回 503，以及无参数仍为固定演示入口。公共字段及查询参数名称没有变化，B 不修改共享文档。

## 需要 D 提供
1. GET /api/demand/[id] 已提供并接入页面；真实身份授权和数据隔离仍待提供。
2. GET /api/provider 已提供 envelope(Provider[])，当前仅 mock；后续提供真实服务方来源和正确访问范围。
3. docs/API.md 仍描述原演示 API；请同步本次 API 和已有页面的接入状态。服务端复用边界已就绪，无需再次放宽。
4. 如果后续按预算/档期过滤，请先在共享 Provider 契约中定义业务字段、单位、来源和未确认值，再通知 B；本次不凭空声称满足预算/工期。

## 交接验收
- 新建两个城市/改造类型不同的需求，A 的链接、B 页面和 B API 分别使用各自的 ID。
- 没有权限或不存在的需求不回退到演示需求。
- 查询失败显示失败，不能静默切换 mock 后标注 live。
- 模拟数据保留 mock；只有完整链路的数据来源均已接通才能标为 live。
- 本次由 B 修改自己的 data.ts 适配层及 API，不要求 D 越界改 B 的业务。

## 本次人工验收入口
- 在 A 创建深圳维修、广州局改需求后，打开各自 /owner/matches/[id]：分别按各自城市/类型匹配，并标明已保存需求与模拟服务方来源。
- /owner/matches/demo-demand：数据库存在该演示需求时显示 2 家深圳施工团队；无此记录则显示未找到，不静默补造。
- /owner/matches/missing-demand：需求未找到。
- /api/match?demandId=<已保存需求ID>：200，结果按实际需求匹配，符合共享 envelope(Match[])，来源仍为 mock。
- /api/match?demandId=demo-demand：数据库存在该记录时 200；不存在时 404；数据库不可用时 503。
- /api/match?demandId=missing-demand：404，不返回默认结果。
- /api/match：固定演示入口，200/mock，不依赖数据库。
