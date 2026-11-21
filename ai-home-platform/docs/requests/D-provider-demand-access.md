# D：已接单服务方读取需求详情

## 具体变更请求

回应 PR #119 合入后的联调反馈：接受报价会把需求变为 contracted，原先仅 published 公开的详情规则使中标服务方也收到 404。本次扩展 GET /api/demand/[id] 的授权，不改公共 DTO、数据库、依赖或 B/C 页面。

没有业主 cookie 时，同一 Serializable 事务核验当前演示服务方会话、角色和 providerId 绑定；SQL 按精确需求 ID，并限制 published 或该 providerId 的真实 ServiceOrder 关系。非公开记录还校验接单与需求、acceptedQuote、服务方、来源及状态一致。仅 submitted/accepted 报价没有 ServiceOrder 不能授权，坏关联返回中性 503/DATABASE_UNAVAILABLE。

匿名、无效服务方凭证、其他服务方、无接单关系访问非公开详情均与不存在统一 404。失效业主 cookie 仍 401，角色不符 403；双 cookie 仍业主优先，不能用服务方身份绕过业主范围。列表保持 published 范围；业主列表保持本人全部状态。当前有效服务方身份是演示身份，整体 meta.source=mock，Demand.source 保留真实数据库记录的 live；所有响应 private, no-store、Vary: Cookie。不暴露 ownerId、会话或接单内部记录。

## 状态推进约束

DemandOrder.status 与 ServiceOrder.status 必须一致。后续 contracted → in_progress → completed 应在同一事务内验证当前身份/关系及双方旧状态，并条件更新两者；任一失败全部回滚。不能先改需求再另发请求改接单。当前没有状态推进 API，本次不伪造或新增推进能力；读取发现不一致继续明确失败，不隐藏损坏数据。

## 给 B 的多报价规则确认项（尚未确认）

现有幂等契约按 providerId + Idempotency-Key 去重，不按 providerId + demandId 去重。不同键可形成多份报价，符合当前实现；同键同内容重放、异内容冲突不能替代业务版本规则。请 B 确认允许独立备选报价，还是每需求每服务方只保留一个有效报价/修订历史，并明确旧报价失效、业主比较、已接受后修改和并发行为。

本次保留既有规则、报价及回执，未更改 B 的模块或新增唯一约束，未声称 B 已确认。失败重试仍用原键原内容，不能换键重报。后续如改规则，先更新公共契约与迁移方案，再由 B 接入。

## 验收

实际接受报价后中标服务方详情 200/mock，逐条 live；匿名、他人、失效会话及仅历史 accepted 无接单仍 404；双 cookie 优先级、列表范围、异常关联和数据库故障保持拒绝。运行隔离 SQLite、check/build/scope、生产 HTTP 冒烟及接单完整链路，交付时记录实际结果。

2026-11-14 本地实际验证：`npm run check` 716/716，通过 lint、类型和模块边界；`npm run build`、D scope（7 文件）、`git diff --check` 通过。生产 HTTP 冒烟通过 13 页面、32 GET、13 POST、3 PUT。隔离测试数据库另跑密码登录 → 创建需求 → 演示报价 → 业主接受 → 服务方详情 200/mock 且记录 live → 退出后 404；实际路由和数据库，无 API 拦截。无新增运行时 mock，服务方身份仍演示；未交付生产服务方认证、状态推进或多报价政策变更。
