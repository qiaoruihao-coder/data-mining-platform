# D：需求 PUT 的业主鉴权与事务更新

日期：2026-11-14。起始基线 main `2a2c1c4`，开发中快进同步至 `d6255e1`（含 #81/#82）。本次仅处理 PUT /api/demand/[id]；不改写 A/B/C 模块，不开放业主登录，也不顺带实施 DELETE、POST 或查询隔离。成员反馈中的登录、删除鉴权、服务方过滤接单已登记到 `docs/tasks/D.md`，按独立 PR 验收。

## 协议变更

- 输入和成功输出继续使用公共 DemandIdParams、DemandUpdateInput、envelope(Demand)，不新增客户端身份字段。非空 ID 保持原值精确查询；空/纯空白为 400。
- PUT 强制同源 Origin，拒绝缺失/跨源 Origin 和 cross-site 请求；沿用服务端已有 Host/loopback 检查，不信任转发主机头。所有成功和失败响应 private, no-store，并 Vary: Cookie。
- 错误顺序：路径 400 → 同源 403 → 业主会话预检 401/403/503 → JSON/字段 400 → 事务内重新验证会话/当前账户 → 归属与状态 → 更新。预检失败不读取请求体或需求，读取请求体时不持有数据库事务。
- 只接受已持久化的业主凭证；缺失、伪造、重复、过期、撤销为 401。只持有服务方演示 cookie 仍缺少业主凭证，返回 401，不转换身份；持有业主凭证但当前账户不是 owner 为 403。认证存储失败为 503，不降级成匿名。
- 写入事务重新验证凭证及当前账户，不能使用预检身份快照授权；两次身份不一致为 403。同一事务按 id + 当前 userId 查询和更新；他人及不存在的需求统一 404 DEMAND_NOT_FOUND，响应相同。
- 当前业主只能修改 draft/published；demo-demand 仍为 409 DEMO_DEMAND_READ_ONLY；contracted/in_progress/completed 为 409 INVALID_STATE。最终更新条件也包含 id、ownerId、可编辑状态，不能只按 id 写入。
- 更新后的 DTO 校验在事务内完成，非法输出、数据库失败或事务冲突均不得报告成功，统一 503 DATABASE_UNAVAILABLE，文案不声称请求一定未保存；客户端应刷新核实。任何拒绝或校验失败回滚事务。

## 范围与交接

已移除旧的无鉴权 updateDemand 服务入口，PUT 路由改用需要原始 Request 的专用处理器，生产路径不能注入自报身份或允许全部请求的 reader。只复用业主会话验证，不复用允许所有状态的报价 GET 授权器。

A 的 apiPut 已处理统一失败信封，可以保留编辑表单并显示 401/403；业主密码/外部认证登录尚未实现，普通浏览器当前不能获得业主凭证，因此本次不宣称浏览器编辑闭环可验收。测试仅通过 D 内部签发函数为合成账号准备凭证，不提供公开 userId 签发接口。

DELETE、需求 POST 固定 demo-owner 和列表/详情隔离仍按现状列为 D 待办。本次 PUT 鉴权不代表整个需求模块已完成权限保护。

## 验收

隔离 SQLite 和真实随机业主 cookie 验证：本人 draft/published 更新成功；非本人/不存在同一 404；匿名/伪造/撤销/过期拒绝；当前角色或归属变化拒绝；同源/输入拒绝不写库；事务内状态/归属变化与非法 DTO 回滚；数据库异常响应不包含私有错误；默认公开路由使用同一实现。

定向测试 `D-demand-update-auth` 与 `D-demand-crud` 共 17 项通过，TypeScript 检查通过。新测试写入临时 SQLite，身份/业务数据均为合成夹具，会话签发和校验使用实际实现；故障与时序变化通过事务装饰器注入，未替换成功鉴权，也不写入开发库。本机 `npm.cmd run db:setup` 已成功同步 #81 的报价来源列。浏览器业主登录及编辑未验收，仍受未交付登录入口限制。

本地完整验收：`npm.cmd run check` 通过（lint、类型检查、467 项测试、模块边界）；`npm.cmd run build` 通过；`npm.cmd run scope -- --role D --base origin/main` 通过（9 个文件）。未新增依赖、未改变公共 DTO 或数据库 schema，新增的鉴权行为及错误顺序按上方协议执行。
