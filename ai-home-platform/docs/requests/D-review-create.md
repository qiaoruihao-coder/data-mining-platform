# D：本人已完成接单的评价保存与读取

后续更新：`docs/requests/D-order-progress.md` 提供正常履约推进与工序确认；生产 HTTP 已改为调用接口达到 completed。下面保留 #126 当时的范围及测试记录，评价页面仍待接线。

## 变更理由与范围（2026-11-14）

`POST /api/review` 仍为 501。此次只实现所属业主对实际已完成接单的一次评价及本人读取，不实现完工状态推进、评价页面、公开评价、服务方评分聚合、审核或通知。由 D 维护契约、数据库和后端，A/C 接线另交各角色。

## 契约与资格

- `ReviewInput` 保留 demandId、providerId、rating、comment；ID 必须非空且非纯空白，原样精确匹配。rating 为 1–5 整数；comment 去首尾空白、最多 2000 字符，可留空只评分。拒绝身份、orderId、source 等额外字段。providerId 只用于核对接单服务方，不授予权限。
- 新增 `Review`：id、demandId、orderId、providerId、rating、comment、source，所有字段必填。新增 `ReviewQuery`：恰好一个 demandId；新增对应 DTO 类型。无其他模块使用旧 ReviewInput，未实现的占位入口现在收紧校验。
- POST 同源、实际业主会话预检，正文最多 16 KiB，拒绝查询参数；Serializable 事务重验同一身份/角色/归属。仅本人非演示需求与实际 ServiceOrder 均为 completed，且 accepted 报价的需求、服务方、来源及状态一致时可提交。没有接单或尚未完成返回 409/REVIEW_NOT_ALLOWED；目标服务方不匹配返回 409/REVIEW_PROVIDER_MISMATCH；坏数据/关联返回 503/REVIEW_UNAVAILABLE。
- 每个接单一条评价。首次 201；当前授权下同一服务方、分数和规范化评论重放 200 返回原记录，内容不同 409/REVIEW_ALREADY_EXISTS。并发最多落一条；409/503 或网络失败后先 GET 核实，再决定是否重试。此次没有修改/删除评价接口。
- `GET /api/review?demandId=…` 在同一事务验证业主与需求归属，返回 `Review[]`；没有评价才返回空数组。没有匿名/固定演示入口、服务方/管理员跨业主读取权限。逐条重验接单关联；旧记录缺少关联或坏数据返回 503，不隐去后伪装空态。
- 评价 source 沿用实际接单与 accepted 报价的持久化来源，mock 不因业主登录/落库升级为 live。GET 非空整体与记录一致；合法本人空列表为 live（固定演示需求空列表为 mock），只表示查询实际执行。live 也不代表评价属实或已审核。不会更新 ServiceProvider.rating、需求状态、接单状态或付款。
- 无/坏/过期/撤销/重复业主凭证或仅服务方为 401；角色改变/跨源为 403；跨业主和不存在需求统一 404/DEMAND_NOT_FOUND。本人的固定演示需求 POST 为 409/DEMO_DEMAND_READ_ONLY。所有成功失败 private, no-store、Vary: Cookie；失败信封无 data/meta。

## 持久化与兼容

Review 增加可空唯一 `orderId`，关联 ServiceOrder，删除关系使用 Restrict；ServiceOrder 增加反向 review。新增 `source` 非空默认 mock 及 demandId 索引。可空仅用于保留历史行；新接口始终写入已验证的 orderId/source，不自动绑定历史评价，也不删除/改写历史内容。升级运行 `npm.cmd run db:setup`，不可重置数据库；旧评价没有可核实关系时由维护者另行处理，此次不迁移为真实评价。

## 接线与验收边界

A/C 使用共享 `apiPost('/api/review', input, Review)`、`apiGet('/api/review?demandId=…', Review.array())`；显示来源、区分 201/200/错误，已存在不同评价不可自动覆盖。实际完工流转 API 尚未实现，常规当前流程只能到 contracted，因此不能宣称用户已可走通施工完成→评价全链路。

测试在隔离 SQLite 中准备明确标记的合成 completed 关系，验证来源、所有权、身份变化、重复/并发、关联破坏及失败回滚。生产 HTTP 冒烟使用真实密码登录与 HTTP 保存/读取；completed 状态仅由测试夹具布置，不把夹具当作已交付的完工接口。

## 实际验证

2026-11-14 本地实际验证：

- `npm.cmd run check`：768/768 测试通过，lint、TypeScript、模块导入边界通过；其中新增评价测试 17/17，覆盖两连接并发、事务内身份/归属/状态变化、最终 SQL 竞争、坏输出回滚及真实旧表重复同步。
- `npm.cmd run build`：生产构建成功；`npm.cmd run scope -- --role D --base origin/main`：13 个文件全部为 D 归属；`git diff --check` 通过。
- 对新建的隔离 SQLite 实际执行 `npm.cmd run db:setup` 成功，seed 保留既有数据。旧表测试保留重复历史评价，orderId=null、source=mock，没有自动创建 ServiceOrder。
- `node scripts/run-production-smoke.mjs`：实际生产 HTTP 全部通过并停止本次服务；包括照片原有链路、评价匿名/参数边界、密码登录→创建需求→接受报价→未完工拒绝→测试准备 completed→评价 201→读取→同内容 200→异内容 409、mock/live 保留、跨业主/坏数据/注销拒绝。
- 冒烟 `AI_MODE=mock`，但评价没有调用 AI 或生成模拟成功响应。完工状态与报价是明确的隔离合成夹具；真实完工流转、A/C 评价 UI、公开评价、评分聚合、审核/通知仍未实现。本次无新依赖、无其他角色业务目录修改。
