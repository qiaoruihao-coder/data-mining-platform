# D：业主确认履约推进，打通完工后的评价

## 具体变更请求（2026-11-14）

#126 的评价接口要求需求与接单均已完成，但没有推进接口，正常流程无法到达。此次增加一个受控履约入口，需求与实际接单始终同事务推进。有排期时补齐最小工序推进，不能将待施工计划直接当成完成；不改 A/B/C 页面、不接支付或 AI。

## 公共契约与规则

新增 `POST /api/order/progress`，输入 `OrderProgressInput`：

- 所有动作必填 demandId、orderId、action、confirmed=true、scheduleVersion。ID 非空且非纯空白、精确匹配；scheduleVersion 必须显式传最新排期版本或 null（确实没有排期）。拒绝其他字段/查询参数，JSON 上限 8 KiB。
- action=start：仅 contracted → in_progress；存在排期时必须所有工序 pending。不自动把工序改成施工中。
- action=start_task：另填 taskId；仅 in_progress 接单，目标工序 pending 且全部前置已 done 时改 active。
- action=complete_task：另填 taskId；仅 in_progress，目标 active 且前置已 done 时改 done。表示当前业主确认工序完成，不是专业质量验收或自动照片检测。
- action=complete：仅 in_progress → completed；有排期必须最新工序全部 done。无排期仍需业主显式确认；不自动生成排期或付款。
- 禁止跳级/回退、跨业主、自报身份或来源。所有动作同源及实际业主预检，写事务内重验同一身份/角色/归属，核对 ServiceOrder 与需求、accepted 报价、服务方及来源一致；坏关联 503，不自动修复。
- 工序动作追加排期下一版，保留旧版与全部计划字段/责任方。只允许责任方 null 或实际接单服务方；其他责任方及 blocked 状态需后续异常处理，不能绕过。
- `OrderProgressResult` 返回 order（OrderSummary）、schedule（Schedule 或 null）；meta.source 沿用接单，mock 不升级。读取核实使用需求详情、已有排期 GET、原报价接受重放和服务方接单列表。结果不含内部操作者信息。
- 最新排期版本必须与请求一致（包括 null）；过期版本 409/SCHEDULE_VERSION_CONFLICT。start 在 in_progress、complete 在 completed、工序在请求目标状态时可返回当前结果 200，不追加操作记录；仍须当前授权、版本及完整性验证。工序动作成功会增加版本，原请求重放会 409，必须刷新核实，不能自动替换版本重发。已 completed 后 start/start_task 等返回 409。

## 持久化、权限和并发

新增 OrderProgressEvent：id、orderId、actorId、action、fromStatus、toStatus、taskId（可空）、scheduleVersion（操作结果版本或 null）、createdAt。关联 ServiceOrder 和 User，Restrict 删除；记录由服务端生成，同事务保存，不暴露到公共响应。无自动历史回填、没有新依赖。上线前运行 `npm.cmd run db:setup`。

生产冒烟 runner 在本次启动的两个子进程中显式设 `DEMO_AUTH_ENABLED=true`（与已有 AI_MODE=mock 相同作用域），以实际 HTTP 登录固定演示服务方、提交报价并检查接单列表/详情；不修改 .env，不更改正常应用默认关闭演示登录的行为。直接运行 smoke.mjs 时须给服务端和冒烟进程设置相同的演示开关，仅使用隔离 seed 测试库。

事务最终更新再次限制 ownerId、需求与接单旧状态、原报价内容和最新排期快照；两个状态更新、排期追加及事件任一步失败全部回滚。相同旧状态/版本并发最多一次实际推进；竞争或无法确认存储返回中性 503，先读取核实。始终 private, no-store、Vary: Cookie。无/坏/重复/过期/撤销业主 cookie 或仅服务方为 401；角色/同源失败 403；他人与不存在需求统一 404，确认本人归属后错误 orderId/缺关系统一 404/ORDER_NOT_FOUND；本人演示需求只读。服务方不能代业主确认完工。

## 接线与边界

A 使用共享 `apiPost('/api/order/progress', input, OrderProgressResult)`，明确展示动作、接单来源与当前排期版本，让业主确认后发送。结果返回后重读需求/排期；409/503 或网络失败先核实，保留错误，不自动重发。完整路径为接受报价 → start →（有排期：按依赖 start_task/complete_task）→ complete → POST /api/review。C 继续读取实际接单列表与授权详情，两侧状态始终一致。

本次只交付后端。A 的按钮及评价表单、服务方开工申请/双方审批、专业验收材料、实际日期、阻塞/返工、施工中计划变更、付款联动、事件查询仍未实现。当前演示服务方的真实落库接单仍为 mock；固定 demo-demand 仍只读。

照片后续两项单独处理：①鉴权及有效引用通过后提供明确 mock 的照片分析结果，live 未接通仍失败，不能用 mock 代替验收；②目前全局 aggregate 未过滤过期照片，只清理本次业主过期行，其他业主过期行仍占全局额度。后续应同时设计回收与物理存储上限，不能仅忽略过期字节而无限积存。

## 验证

- `npm.cmd run check`：787/787 测试通过，含新增履约测试 17/17；lint、typecheck、模块导入边界通过。
- `npm.cmd run build`：通过，新增路由为动态接口。
- `npm.cmd run scope -- --role D --base origin/main`：14 个文件全部属于 D；`git diff --check` 通过。
- 隔离 SQLite 上 `npm.cmd run db:setup` 与 `node scripts/run-production-smoke.mjs` 均通过。实际 HTTP 登录→演示服务方报价→接受→创建依赖排期→开工→逐项完成→整单完成→评价；服务方接单列表/需求详情返回一致状态，旧版排期保留。另验证无排期路径、mock/live 来源、越权/旧版本/跳级/退出拒绝，完成状态未直接改库伪造。
- 冒烟仅使用随机合成账号及数据，结束清理。演示服务方/报价/接单/评价明确 mock；live 来源分支的报价仍为直接入库的合成夹具，不代表已实现生产服务方认证或真实履约。
- 本机 Node.js 26；远端 Node.js 22 的 CI 与 Production HTTP smoke 结果随 PR 记录。
