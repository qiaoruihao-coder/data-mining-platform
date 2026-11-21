# D：业主读取本人接单摘要

## 具体变更请求（2026-11-14）

履约要求 orderId，评价要求 providerId，但当前业主只能重新 POST 接受已选报价来取得接单。新增只读 `GET /api/order?demandId=…`，供 A 页面直接接线；不改 A/B/C 页面，不增加依赖或数据库字段。

## 公共契约与返回

- 新增 `OrderQuery`：严格 `{ demandId }`，复用 OrderAcceptInput 的精确非空 ID 校验。URL 必须恰好一个 demandId，拒绝缺失、空白、重复及其他参数；不去除 ID 首尾空白。
- 新增 `OwnerOrderResult = OrderSummary.nullable()` 及 DTO。有实际接单返回 200 `envelope(OwnerOrderResult)`，data 为原 OrderSummary；使用 data.id 调用履约，data.providerId 调用评价。
- 本人需求确实没有接单返回 200/data:null，来源沿用需求（固定 demo-demand 为 mock，其他为 live）。历史 accepted 报价不补造接单；已处于 contracted/in_progress/completed 却缺接单属异常，返回 503，不能伪装正常空态。
- 有接单时逐条及整体 source 沿用已校验的接单，不因真实业主登录而把 mock 升级为 live。

## 权限与一致性

只读 GET/HEAD；查询参数先校验，再在同一 Serializable 事务验证当前业主会话、账号角色、需求 ownerId、实际 ServiceOrder 与 accepted 报价关联。仅服务方凭证不能取得业主权限，双 cookie 以业主为准。公开 published 需求也不公开接单；demo-demand 没有匿名例外。

无/坏/重复/过期/撤销业主会话为 401/UNAUTHENTICATED；非业主角色为 403/FORBIDDEN；他人和不存在需求统一 404/DEMAND_NOT_FOUND；非法参数 400/VALIDATION_ERROR。存储、来源/DTO/状态或关联损坏为 503/ORDER_UNAVAILABLE；不回退 mock 或空态。所有响应 private, no-store、Vary: Cookie，不含 ownerId、会话、报价明细或其他内部字段。成功和失败均不写业务数据。

## A 接线与边界

`apiGet('/api/order?demandId=' + encodeURIComponent(demandId), OwnerOrderResult)`；data:null 显示尚无接单，有值后显示 source，并使用 id/providerId。进入页面、履约操作后以及 409/503/网络失败后可重新 GET 核实，无需为读取再次 POST 接受报价。保持错误可见，不用旧编号或本地假数据兜底。

本次后端只读入口不实现 A 的按钮/表单接线、生产服务方认证、公开接单或管理员全量读取；照片 mock 分析及过期配额另行交付。

## 验证

- `npm.cmd run check`：800/800 测试通过，含新增 10 项；lint、typecheck、模块导入边界通过。
- `npm.cmd run build`：通过。
- `npm.cmd run scope -- --role D --base origin/main`：10 个文件全部属于 D；`git diff --check` 通过。
- 隔离 SQLite 上运行 `node scripts/run-production-smoke.mjs` 通过：HTTP 登录→创建需求→GET 空接单→报价/接受→GET 取得 id/providerId→履约推进→评价；读取 contracted/in_progress/completed 与 mock/live 来源正确。另验证非法参数、匿名/仅服务方/跨业主/注销后的拒绝。
- 无运行时假数据或 fallback；演示服务方报价及其接单仍 mock，live 来源报价为合成存储夹具。完成状态通过真实 HTTP 推进。未修改 A 页面。
- 本地 Node.js 26；远端 Node.js 22 CI（含 Production HTTP smoke）结果随 PR 记录。
