# D：接受报价并建立接单关系

## 变更理由与范围

接续 PR #117 和 `C-provider-orders.md` 的请求，提供业主接受报价与服务方读取接单的最小闭环。先冻结本契约，再由 D 修改共享类型、Prisma 和基础设施；B 的报价页面、报价引擎及 C 的本人报价页面由各自负责人接入，本 PR 不修改这些目录。不增加依赖或改变技术栈。

## 公共契约与接口

- 新增 `OrderAcceptInput`：严格对象 `{ demandId, quoteId, confirmed: true }`。两个 ID 非空且非纯空白，原样精确匹配；不接受身份、来源、金额、状态或未知字段。正文最多 4096 字节，无查询参数。
- 新增 `OrderSummary`：必填 `id`、`demandId`、`providerId`、`acceptedQuoteId`、`status`（contracted / in_progress / completed）及 `source`（mock / live）。只代表平台保存的接单关系，不包含价格、实际工期、支付或履约证明。
- `POST /api/order`：所属业主同源确认接受报价；首次 201 `envelope(OrderSummary)`，相同需求和报价的授权重放 200，返回原关系。请求本身即可用于网络结果不确定后的重试核实，无须新增幂等键。
- `GET /api/provider/orders`：无参数，仅返回当前已验证服务方的 `envelope(OrderSummary[])`，按 id 升序（非成交时间顺序）。实际无记录才返回空数组；旧 accepted/mock 报价不会自动转换为接单。

## 数据、状态与一致性

新增 Prisma `ServiceOrder`：demandId 唯一、acceptedQuoteId 唯一，分别关联现有 DemandOrder、ServiceProvider、Quote；source 和 status 持久化，数据库默认来源保守为 mock。已有数据不回填订单，seed 不创建订单。部署前运行 `npm run db:setup`，不 reset 或接受数据丢失。

本版一个需求只能接受一份报价、建立一个服务方关系；不支持多工种拆单、改选、取消或拒绝。首次仅允许本人非演示 published 需求和同需求的 submitted 报价；已有 accepted 但无关系的历史数据返回冲突，不能据此补单。接受时同一 Serializable 事务重验当前业主、归属和状态，更新需求为 contracted、目标报价为 accepted 并创建关系；最终条件写入核对原始报价内容/状态、当前归属和无其他接单/accepted 报价，任一步失败全部回滚。其他报价及既有提交幂等回执保留；原报价提交/回执重放在需求签约后仍按已有规则拒绝。

相同报价重试仍需当前有效业主会话和归属，校验关系、需求状态及 accepted 报价一致后返回原记录；改选另一报价返回 409。已进入 in_progress/completed 的一致关系也可重放读取，但本次不提供这些状态的推进。查询发现关系与报价/需求不一致、坏来源或坏 DTO 时失败，不返回假成功。

含 null 费用或待确认项的报价可被选择，但接单摘要不声明最终总价，也不填补费用；原报价明细和未知值完整保留。B 确认界面需展示待定费用及来源，并说明选择关系不代表付款或施工验收。

## 授权、来源与错误

写入先同源/方法检查、参数检查、实际业主会话预检，再在事务外读取正文；写事务重验同一身份、当前角色和需求归属。匿名/失效/撤销/重复/过期业主 cookie 或只有服务方 cookie 为 401，角色变化/跨源为 403。他人和不存在需求统一 404；确认本人归属后，不属于该需求的报价与不存在报价统一 404。演示需求只读，非法状态/已有其他接单/旧 accepted 冲突为 409。

服务方读取复用现有演示服务方认证，与本人报价接口一致：有效服务方会话优先，仅业主会话为 403，无有效服务方身份为 401；每次在查询事务内重验有效期、当前角色及固定绑定。关闭演示、过期、撤销或绑定失效均拒绝。客户端 providerId/userId/角色头不能改变权限。

每条关系来源沿用接受时的报价来源（需求必须为非演示数据库需求），持久化不升级 mock。非法来源直接失败；关系来源与关联报价来源不一致也失败。POST meta.source 与关系一致，GET 整体始终 mock，因为目前只有演示服务方认证；逐条保留实际 source，包括授权空列表。所有成功/失败均 private, no-store、Vary: Cookie；存储/事务/输出异常 503 ORDER_UNAVAILABLE，提示暂时无法确认结果，可对同一报价重试核实，不承诺上次一定没写入。

## B/C 接入方式及未实现内容

- B：用户明确确认后 `apiPost('/api/order', { demandId, quoteId, confirmed: true }, OrderSummary)`，成功后刷新需求/报价，显示逐条及整体来源；409 不自动改选，503 保留相同输入以便核实。禁止客户端模拟 accepted 或接单成功。
- C：`apiGet('/api/provider/orders', OrderSummary.array())`，显示关系编号/需求/报价/服务方及状态、来源；现有 `/api/provider/quotes` 仍是本人报价，不等于接单。只传固定路径，不传身份参数；错误清除旧列表，不能展示为成功空态。
- 本次仅交付后端，B 接受按钮与 C 接单 UI 尚待接入。生产服务方认证、多服务方合同、支付、通知、履约状态推进、取消/改选、施工中变更、照片检查和评价未实现。

## 验收

隔离 SQLite 验证当前身份、跨业主/跨需求、只读/状态、来源、原子回滚、同一报价重试、竞争报价并发最多一条关系、本人服务方列表及旧 accepted 不补单。运行全量 check/build/scope、实际生产 HTTP 冒烟，PR 确认远端 Production HTTP smoke。

### 实际本地结果（2026-11-14）

- `npm run check` 通过：707/707，含本次 16 项测试；lint、类型和业务模块边界均通过。
- `npm run build` 通过；`npm run scope -- --role D --base origin/main` 通过，11 个文件均归 D；`git diff --check` 通过。
- 隔离临时 SQLite 运行 `npm run db:setup`，生产构建实际运行 `scripts/run-production-smoke.mjs`：13 个页面、30 个 GET、13 个 POST、3 个 PUT 场景通过，测试服务自动停止。
- 另用同一生产构建和隔离数据库实测 HTTP 密码登录 → 创建需求 → 演示服务方提交报价 → 业主读取 → 接受 201 → 同报价重放 200 → 本人接单列表。关联关系、需求 contracted、报价 accepted 一致，0.145 × 100 分仍为 15 分、未知金额仍 null、来源仍 mock；另一业主 404、服务方不能代业主接受、身份参数 400、签约后原报价回执重放 409、两方退出后均 401。测试数据均合成，未拦截 API，未做 B/C 页面验收。
- 未增加运行时假成功或默认订单；演示身份与演示报价继续为 mock，测试 AI_MODE=mock。本地验证不是生产服务方认证。远端 CI 结果见 PR 检查。
