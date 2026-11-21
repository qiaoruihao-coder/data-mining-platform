# D：业主读取本人履约操作记录

2026-11-14。履约写接口已原子保存 OrderProgressEvent，本次提供最小只读接口，供 A 后续展示已有记录；不新增履约动作或代做页面。

## 变更请求

- 新增 `GET /api/order/progress?demandId=<id>`，复用公共 `OrderQuery`；恰好一个非空 demandId，原样精确匹配，拒绝其他参数或重复参数。
- 新增公共 `OrderProgressEvent` 与 DTO：`id`、`orderId`、`action`、`fromStatus`、`toStatus`、`taskId`（无工序时 null）、`scheduleVersion`（无排期时 null）、`createdAt`（ISO 8601）、`source`。动作及状态组合必须符合现有履约写入规则，工序动作必须有工序 ID 和至少为 2 的结果版本。
- 返回 `200 envelope(OrderProgressEvent[])`。每条和整体来源沿用已验证的接单；没有接单且需求为 draft/published 时返回空数组，来源沿用需求。已有接单但无历史事件也返回空数组，不给种子或历史数据补造记录。后续状态缺接单、坏字段/来源/关联及存储失败均为 503，不能伪装空态。
- 同一 Serializable 事务核验业主会话、当前角色、需求归属、接单/accepted 报价关系，再以当前 orderId + demandId + ownerId 过滤事件。事件 SQL 只选公开字段，不读取 actorId；响应不返回姓名、凭证或报价明细。事件按 createdAt 升序、同时间按 id 升序稳定排序；同毫秒排序不表示实际动作先后，不保证历史记录完整性或专业验收结论。
- 无/失效/重复/撤销/过期业主 cookie 或只有服务方 cookie 为 401；角色不符为 403；他人与不存在需求统一 404。无匿名演示例外，双 cookie 仍业主优先。所有响应 `Cache-Control: private, no-store`、`Vary: Cookie`。

本次新增兼容的只读契约，无 schema、依赖或配置变更；POST 行为保持既有约定。错误码为 VALIDATION_ERROR、UNAUTHENTICATED、FORBIDDEN、DEMAND_NOT_FOUND、ORDER_PROGRESS_UNAVAILABLE。查询不会推进业务状态、重放动作或写入事件。

## A 接线

使用 `apiGet('/api/order/progress?demandId=' + encodeURIComponent(demandId), OrderProgressEvent.array())`，显示来源与服务端记录时间。仅成功空数组可显示“暂无履约记录”；权限和 503 错误保持可见，不回退 mock。记录只表示业主确认动作，不代表真实付款、专业验收或 AI 判断。页面接线另由 A 完成。

## 实际验证（2026-11-14）

- 隔离 SQLite 专项 13/13 通过：实际 POST 产生四类记录、同态重放不重复、mock/live 不混淆、稳定排序、合法空态、参数/会话/归属隔离、坏关联/事件与存储异常、只读及隐私字段检查。
- 同步 main `4b334f7`（包含 #149、#150、#151）后，`npm.cmd run check`：928/928，lint、typecheck、boundaries 全部通过。
- `npm.cmd run build` 通过；`npm.cmd run scope -- --role D --base origin/main` 通过，10 个本任务文件；`git diff --check` 通过。
- 全新隔离 SQLite 完成 db:setup 后，`node scripts/run-production-smoke.mjs` 通过：正常 HTTP 登录/报价/接受/开工/工序/完成后读到真实保存的记录，验证空态、重放、来源、跨业主/服务方/注销拒绝及坏事件 503；同时通过原有页面、照片、履约与评价链路。测试子进程已停止，原数据库与 `.env` 保留。
- 初次旧 main 的冒烟在既有 calculatedAt 跨进程时间比较处失败；随后同步已经合入的 #151 修复并重新运行完整检查、构建和冒烟，最终全部通过。本 PR 不重复携带该修复。

没有新增运行时 mock 或接入真实 AI。验收使用合成账号/照片、既有演示服务方和 mock 报价；live 来源报价仅为现有存储夹具，后续履约与记录读取均通过实际接口。本次只交付后端查询；A 的记录展示、服务方/管理员记录权限、专业验收和付款联动仍未提供。
