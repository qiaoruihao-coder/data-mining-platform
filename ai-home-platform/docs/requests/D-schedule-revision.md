# D：确认修订尚未开工的排期并保留版本

日期：2026-11-14；基于 main 51792c7。#112 首版排期已合入；本任务不依赖仍待合并的工单 PR #116。

## 公共变更请求（实现前记录）

新增 `PUT /api/schedule` 和公共 `ScheduleRevisionInput`/推导类型，沿用 `Schedule` 输出及原有 GET 的最新/指定版本查询。复用首版创建的工序字段、数量限制、依赖图和整数工期校验，不维护第二套规则。

```json
{"demandId":"本人需求 ID","baseVersion":1,"confirmed":true,"tasks":[{"id":"prepare","name":"现场准备","startDay":0,"durationDays":2,"dependsOn":[]},{"id":"work","name":"施工计划","startDay":2,"durationDays":3,"dependsOn":["prepare"]}]}
```

- demandId 精确匹配、不 trim；baseVersion 必须是当前最新版本，正整数且小于 SQLite Int 上限；confirmed 必须显式为 true。tasks 完整替换计划工序，1–100 项，复用 `ScheduleCreateTaskInput` 及首版依赖校验。可以增删工序和调整名称/工期/依赖，旧版不变。
- 严格拒绝身份、来源、目标 version、工序状态、责任方等额外字段；请求体最多 64 KiB，不接受查询参数。确认代表当前业主确认保存此手工计划，不代表其他参与方审批、合同变更或阶段验收。
- 沿用现有 Schedule 表和 (demandId, version) 唯一键，无 schema、依赖、环境配置变更。成功 201 `envelope(Schedule)`/live，新版 version=baseVersion+1，所有工序仍 pending、responsibleProviderId=null。

## 权限、边界及并发

仅同源 PUT。实际业主会话预检 → 事务外读取/校验正文 → Serializable 写事务重验同一身份、当前角色、需求归属和状态。本人非演示需求必须处于 published/contracted，最新排期所有工序必须 pending 且尚未分配责任服务方；active/done/blocked 或已有责任方的计划不能经此接口重置。正在施工的异常变更另行设计审批流程。

最新排期必须存在且通过公共字段和依赖图校验，不能用修订覆盖坏数据。输入 baseVersion 与最新版本不符时 409 SCHEDULE_VERSION_CONFLICT，客户端须刷新后重新比较、重新确认；不得自动换版本重发。最终嵌套写入继续限制归属、需求状态、原排期 ID/版本/内容及不存在更新版本，只追加一行，不 update/delete 旧版。输出验证在提交前完成，失败回滚。

- 无/坏/重复/过期/撤销业主 cookie，或只有服务方 cookie：401 UNAUTHENTICATED；当前账户角色不是业主、非同源或两次身份不一致：403 FORBIDDEN。
- 他人与不存在需求统一 404 DEMAND_NOT_FOUND；确认本人归属后，无初始排期 404 SCHEDULE_NOT_FOUND、固定演示需求 409 DEMO_DEMAND_READ_ONLY、需求状态非法 409 INVALID_STATE、已有施工状态或责任方 409 SCHEDULE_REVISION_NOT_ALLOWED。
- JSON 错误 400 INVALID_JSON；字段/确认/版本范围/依赖/正文超限 400 VALIDATION_ERROR。数据库、事务竞争或坏 DTO 为中性 503 SCHEDULE_UNAVAILABLE；同一 baseVersion 并发至多一个新版成功，其余 409 或 503。网络错误/503 后先 GET 核实，不能宣称之前一定未保存。
- 所有响应 private, no-store、Vary: Cookie。旧版本通过原 GET 仍可读取；需求状态不自动推进，POST 首版创建仍拒绝任何已有版本。

## A 接入与未实现内容

先 GET 最新 Schedule，保留其 version 并展示变更；业主确认后使用 `apiPut('/api/schedule', { demandId, baseVersion, confirmed: true, tasks }, Schedule)`。保存成功刷新最新版本，需要对比时再 GET `?demandId=…&version=旧版本`。live 仅表示计划实际保存；页面必须显示来源。

本次提供后端修订接口，不修改 A 页面。尚未实现修订表单/差异展示、变更原因或审批审计记录、服务方确认、施工中的异常变更、责任方分配、任务状态推进和阶段验收；现有验收按钮不能调用此接口冒充验收。

## 验收计划

隔离 SQLite 和合成账号验证 v1→v2→v3、旧版内容不变、读取最新/指定版本、旧版/未来版/重复请求拒绝、并发至多一个新版、状态与责任方限制、双业主隔离、事务内身份/归属变化、最终写入条件与坏输出回滚；执行公开登录路由闭环及生产 HTTP 测试。运行 check、build、D scope 和更新后的生产冒烟，提交 PR 后确认远端 CI。

## 实际验证（2026-11-14）

- 首版创建及修订定向测试 28/28；`npm run check` 全量 664/664，lint、typecheck、boundaries 均通过。
- 临时独立 SQLite 执行 `npm run db:setup` 成功，`npm run build` 通过；没有修改 .env、既有业务数据库、schema、依赖或锁文件。
- `npm run scope -- --role D --base origin/main`：8 个 D 文件通过；`git diff --check` 通过。
- 实际生产 HTTP 冒烟通过 13 个页面、20 个 GET、7 个 POST，以及新增的 3 个 PUT 拒绝场景。
- 合成账号在实际 `next start` HTTP 服务完成密码登录 → 创建需求/v1 → PUT v2（201/live）→ GET 最新/v2 一致、v1 内容不变；旧版重试 409、未确认 400、跨源 403、另一业主 404、退出后修订 401。数据库仅有 v1/v2，两个测试服务均已停止。
- 本地 Windows/Node 26；远端 Ubuntu/Node 22 CI 和 Production HTTP smoke 结果见 PR 检查记录。

测试账号及样本是合成数据，密码认证、版本写入及读取为实际实现；测试环境 AI_MODE=mock，固定演示排期继续明确标 mock，本功能没有调用 AI。未做新表单的浏览器验收；上方列明的 UI 与审批/施工功能仍未实现。
