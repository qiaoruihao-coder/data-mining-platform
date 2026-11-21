# D：业主提交并读取本人需求工单

日期：2026-11-14；基于 main 51792c7（#112 已合入）。本次交付工单创建和按需求读取，沿用现有 Ticket 表，不改依赖、配置或其他角色业务目录。

## 公共变更请求（实现前记录）

新增 `TicketCreateInput`、`TicketQuery` 及推导类型，补充 `TicketDTO` 导出；已有 `Ticket` 输出不变。

```json
{"demandId":"本人需求 ID","description":"墙面出现潮湿，申请现场核实。","category":"quality"}
```

- 创建字段仅 demandId、description、category。demandId 非空且非纯空白，保留原值精确匹配；description 去首尾空白后 1–4000 字符；category 复用 Ticket 的 quality/schedule/payment/attitude。拒绝未知字段，不能自报 ownerId、id、status、responsibleProviderId、source 或 meta；正文上限 16 KiB。
- POST /api/ticket 不接受查询参数，要求同源 Origin 和实际业主会话。预检通过后在事务外读取正文，再在 Serializable 写事务重新校验身份、当前角色、归属及状态。仅本人非演示的 published/contracted/in_progress/completed 需求可提交，draft 不可提交。
- 服务端生成 ID，固定 status=open、responsibleProviderId=null。最终写入再次限制需求 ID、ownerId、当前状态；持久化输出校验在提交前完成，失败回滚。成功 201 envelope(Ticket)/live；live 只表示实际保存业主报告，不表示投诉属实、责任已认定、已通知服务方或完成售后。
- GET /api/ticket?demandId=… 返回本人该需求的 Ticket[]，按 id 升序（不表示时间顺序）；各需求状态均可读，合法空结果为 200/live。身份、需求归属和受限读取处于同一事务，绝不返回全站真实工单。
- 无参数或精确 demo-demand 仍返回固定种子工单/mock，供 C 现有只读演示页面兼容使用；不读取同 ID 的可变数据库记录。存在业主 cookie 时必须先验证，即使演示入口也不允许失效凭证回退匿名。GET 只接受恰好一个非空 demandId，拒绝未知/重复/身份参数。

## 错误和一致性

无/坏/重复/过期/撤销业主 cookie 为 401 UNAUTHENTICATED；只有服务方 cookie 同样 401，不授予工单权限。当前账户不再是业主、非同源写入为 403 FORBIDDEN。他人与不存在的需求统一 404 DEMAND_NOT_FOUND；本人固定演示需求只读 409 DEMO_DEMAND_READ_ONLY，非法写入状态 409 INVALID_STATE。JSON/输入错误为 400 INVALID_JSON/VALIDATION_ERROR。数据库、事务或 DTO 错误统一 503 TICKET_UNAVAILABLE，不回退 mock/成功空列表，也不泄漏内部异常。

所有响应 private, no-store、Vary: Cookie。创建的 503/网络失败不能解释为一定未保存，先 GET 核实再决定重试。本最小接口没有幂等键或内容去重，重复提交会创建独立工单，调用方须避免自动重发。数据库实际写入不会改变需求状态或生成派单/通知。

## A/C 接入与未实现内容

合入后使用共享 `apiPost('/api/ticket', input, Ticket)`，再 `apiGet('/api/ticket?demandId=' + encodeURIComponent(id), Ticket.array())`，显示响应来源。共享业主登录后才能处理本人需求；401 提示重新登录，403 提示身份权限问题，404 不区分他人与不存在。现有无参数管理页仍只展示固定 mock，不会自动获得真实工单或管理员权限。

创建表单、管理员/服务方工单范围、派单/解决状态流转、通知、照片检查、评价和排期变更审批另行实现；本次不修改 A/C 页面，不调用 AI。

## 验收计划

隔离 SQLite 和合成账号验证真实创建/跨连接读取、各状态和四分类、认证/同源/输入拒绝、精确 ID、双业主隔离、事务内撤销/角色/归属变化、最终写入限制与坏输出回滚，以及实际密码登录到公开路由的闭环。同步 scripts/smoke.mjs 并实际运行 check、build、D scope、生产 HTTP 冒烟；推送后检查 CI Production HTTP smoke。

## 实际验证（2026-11-14）

- 定向测试 14/14；`npm run check` 全量 663/663，lint、typecheck、boundaries 均通过。
- `npm run db:setup` 在临时独立 SQLite 成功；`npm run build` 通过。未修改 .env、已有业务数据库、schema、依赖或锁文件。
- `npm run scope -- --role D --base origin/main` 通过：8 个 D 文件；`git diff --check` 通过。
- `node scripts/run-production-smoke.mjs` 在实际生产服务上通过 13 个页面、26 个 GET、10 个 POST 场景，含工单固定演示/失效凭证/匿名读取/同源写入拒绝。
- 临时合成账号在实际 `next start` HTTP 服务完成密码登录 → 创建需求 → 工单 201/live → 本人 GET 数据一致。固定 mock 不包含新工单；非法责任方 400、跨源 403、匿名 401、跨业主读写 404、退出后真实及演示读取/写入 401；数据库只保留一次成功创建。两个测试服务均已停止。
- 本地 Windows/Node 26；远端 Ubuntu/Node 22 的 CI 结果以 PR 检查记录为准。

测试账号和样本为合成数据；密码认证、事务写入和读取是真实实现。生产冒烟使用 AI_MODE=mock，固定演示工单仍明确标 mock；本功能没有调用 AI。页面表单与售后流转仍待相应后续任务，没有声称完成浏览器页面交互验收。
