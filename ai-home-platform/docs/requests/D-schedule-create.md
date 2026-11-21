# D：创建本人需求的首版排期

日期：2026-11-14；基于 main 917b960（已合入 #104、#108）。本次先交付一个可验收写入：真实业主为本人尚无排期的需求保存手工计划，并通过现有 GET 读取。不是自动 AI 排期、合同签订、服务方承诺或阶段验收。

## 公共变更请求（实现前记录）

新增 `ScheduleCreateInput` 和推导类型，复用 `ScheduleTask` 的基础字段；已有 Schedule/GET 输出不变。POST /api/schedule 请求：

```json
{"demandId":"本人需求 ID","tasks":[{"id":"prepare","name":"现场准备","startDay":0,"durationDays":1,"dependsOn":[]},{"id":"work","name":"施工计划","startDay":1,"durationDays":3,"dependsOn":["prepare"]}]}
```

- demandId 为非空且非纯空白字符串，精确匹配、不 trim。tasks 必须 1–100 项；工序 ID 非空、非纯空白、最多 128 字符并在本排期内唯一；name 去首尾空格后 1–200 字符。
- startDay 为非负整数，durationDays 为正整数；两者及结束日不超过 SQLite Int 上限。dependsOn 必填、最多 99 个不重复的本排期工序 ID，不得自依赖、缺失或成环；每个工序不得早于依赖工序结束。独立工序可以并行。
- 顶层及工序均拒绝未知字段，不能指定 ownerId、version、status、responsibleProviderId、source 或验收结果。服务端固定 version=1、status=pending、responsibleProviderId=null。没有接单关系时不能自行指定服务方。
- 请求体上限 64 KiB。成功 201 `envelope(Schedule)` / live；live 仅表示手工计划实际落库，未调用 LLM，需求状态不随创建排期自动改变。

## 权限、状态和一致性

POST 强制同源 Origin，拒绝查询参数。先验证当前业主会话，再在事务外读 JSON/校验契约；在 Serializable 写事务重新核验同一业主身份、当前账户角色、需求归属及状态。最终写入仍限制需求 ID、ownerId、当前状态及没有任何排期，输出校验失败必须回滚。

- 无/失效/重复/过期/撤销业主 cookie：401 UNAUTHENTICATED；当前角色不是业主：403 FORBIDDEN。只有服务方演示 cookie 也不能写入，返回 401；双 cookie 只按业主凭证判断。
- 非本人和不存在需求统一 404 DEMAND_NOT_FOUND。确认归属后，demo-demand 为 409 DEMO_DEMAND_READ_ONLY。
- 仅 published / contracted 可建立初始计划；draft、in_progress、completed 和未知状态为 409 INVALID_STATE。本次不更改需求状态。
- 已有任意排期版本返回 409 SCHEDULE_ALREADY_EXISTS，不覆盖、不新增 v2。重复提交应读取现有排期核实；并发受事务和 demandId/version 唯一约束保护，最多一个 v1。存储或事务冲突返回 503 SCHEDULE_UNAVAILABLE，提示刷新核实，不声称此前一定未保存。
- 所有成功/失败响应 private, no-store、Vary: Cookie。非法字段/依赖为 400 VALIDATION_ERROR，坏 JSON 为 400 INVALID_JSON；不回退演示数据，不把 501 当作成功。

## A 的接入与范围

合入后 A 可先用 `ScheduleCreateInput` 校验，再 `apiPost('/api/schedule', input, Schedule)`，保存成功后刷新 `GET /api/schedule?demandId=...`。当前页面没有创建表单，本 PR 不修改 A 的私有页面或组件。已有变更申请/验收按钮不能提交为创建动作；后续需各自定义审批、版本变更、验收契约。

沿用现有 Schedule 表和唯一索引，无 schema、依赖、环境变量变更。工单、照片检查、评价和 match 审计不在此次范围。

## 验收计划

用隔离 SQLite、合成账号与真实会话验证创建后 GET 最新/指定版本一致、双业主隔离、同源及身份拒绝、状态/演示/重复限制、事务内撤销或归属变化、输出损坏回滚、并发最多一条。同步旧 POST 501 测试及生产冒烟断言；实际运行 db:setup、check、build、D scope 和生产 HTTP 冒烟，创建 PR 后确认 CI 中 Production HTTP smoke 为绿色。

## 实际验证（2026-11-14）

- 基于现有 schema 为临时目录中的独立 SQLite 运行 `npm run db:setup` 成功，未修改 .env、个人业务数据库或依赖。
- 排期创建/读取定向测试 24/24 通过；全量 `npm run check` 627/627 通过，lint、typecheck 和 boundaries 均成功。首次类型检查的测试请求头推断问题修正后完整重跑通过。
- `npm run build` 成功。随后 `node scripts/run-production-smoke.mjs` 在真实生产 Next 服务上通过 13 个页面、20 个 GET、7 个 POST 场景，已将原 POST 501 改为同源与身份拒绝断言。
- 用临时合成账号在真实 `next start` HTTP 服务完成密码登录 → 创建需求 → POST 排期 201/live → GET 最新与 v1 一致；重复写入 409、非法依赖 400、跨域 403、另一业主读写 404、退出后写入 401，数据库仅有一条 v1。测试服务结束后已停止。
- `npm run scope -- --role D --base origin/main`：9 个 D 文件通过；`git diff --check` 通过。未修改 A/B/C 私有目录、schema、依赖或锁文件。
- 本地为 Windows / Node 26；PR 远端 Ubuntu / Node 22 的 CI 和 Production HTTP smoke 结果以 PR 检查记录为准。

账号和数据库均为合成测试用途；账号认证及排期读写为实际实现。AI_MODE=mock，固定演示数据仍显示 mock；本功能没有调用真实 AI。A 的创建表单、变更/验收按钮接线和上述其他业务待办仍未实现，没有浏览器页面交互验收。
