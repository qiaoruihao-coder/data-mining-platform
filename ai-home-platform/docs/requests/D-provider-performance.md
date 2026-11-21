# D：公开目录的已完成接单评价汇总

2026-11-14，先记录共享变更。落实 B #133 与 `D-match-ranking-response.md` 的第一步；只交付评价汇总，不做档期、排序或报价种子调整。

## 公共字段与接口

- 新增 `ProviderPerformance` / DTO：`basis` 固定 `completed_order_review_average`；`averageRating` 为 1–5、最多两位小数的有限数或 null；`reviewCount` 为非负安全整数，0 必须搭配 null，正数必须有均分；`calculatedAt` 只校验 ISO 8601 datetime 格式，`source` 复用公共 Source。服务端当前用 `new Date().toISOString()` 生成时间，但公共契约不依赖浏览器本地时钟判断“未来”，以容忍客户端时钟偏差。
- Provider 增加可选 `source` 与可选/可空 `performance`，兼容旧消费者；缺省/null 表示未提供汇总，不等于成功查询无样本。保留原 rating，不能称其为履约评价分。
- `GET /api/provider?performanceSource=live|mock`，省略时 live；仅接受一次该参数，空值/未知值/重复/其他参数 400。返回 `envelope(Provider.array())`；无样本明确 averageRating=null、reviewCount=0，不回退种子 rating 或另一种来源。
- 公开目录仍是原有六个固定演示服务方，基础资料显式 source=mock，本次不扩大为全部数据库服务方。整体 meta.source 仍 mock；每条 performance.source 表示所选统计口径。仅输出汇总，不暴露评论、业主、需求、接单或评价 ID。不新增公开评价明细入口。

## 读取及有效样本

共享 `readProviderDirectory` 服务端只读适配器与 HTTP 使用同一实现，B 后续可调用；本次不改 B `/api/match` 或排序代码。默认只在 Serializable 事务快照中计算，不缓存、不写库、不修改 ServiceProvider.rating。成功/失败均 no-store。

查询覆盖评价自身、绑定接单或评价所属需求的接单指向目录的记录，不提前按来源/完成状态过滤，以免把错绑或坏来源悄悄当作无样本。旧的 orderId=null 评价明确不在口径内。绑定记录必须满足：需求/接单 ID、服务方、需求业主一致；需求/接单状态一致；accepted 报价与接单的 ID、需求、服务方相符且状态 accepted；评价/接单/报价来源均合法且一致。固定 demo-demand 不可补造成有效评价。损坏关联、非法评分/来源或存储故障返回 503/PROVIDER_UNAVAILABLE，整个目录失败，不伪装成空样本。

结构与关联一致的 contracted/in_progress 接单不计入；只有需求与接单均 completed 才计入所选来源。每接单最多计一次，异常重复绑定报错，重放不会扩大样本。逐服务方平均值四舍五入两位；全部服务方共享同一 calculatedAt。未发布到目录的服务方评价不公开，也不计入目录其他服务方。

若查询范围内任一评价或关联数据损坏，当前实现仍让整个目录返回 503/PROVIDER_UNAVAILABLE，而不是把单个 `performance` 降级为 null。C 的需求页和 B 的匹配页会因此无法完成服务方目录加载；B 的报价对比页会保留已读取的报价，但服务方名称和来源提示为待确认。将来若要按服务方降级，需要另行定义错误/部分成功契约。

## 验收与后续

隔离 SQLite 覆盖 0/1/多条、四舍五入、mock/live 混合、旧/未完成排除、错绑/坏来源失败、重复/快照/只读与隐私。生产 HTTP 在既有实际登录→接单→完工→评价流程中验证汇总和重放，并确认默认 live 不回退 mock。执行 check/build/D scope 与远端 Production HTTP smoke。

后续进展：固定 mock 档期、报价单位/列项提醒和合成 completed 接单/评价样本已由 `D-provider-availability.md` 交付，README 提供固定样例验收步骤。仍待 B 接同源、全组有效的排序和来源展示，以及最终演示版本集成。无依赖、schema 或 .env 变更。

## 实际验证（2026-11-14）

- 专项测试 11/11：旧 Provider 兼容、无样本/单条/多条与四舍五入、来源分离、未完成/无绑定旧评价排除、错绑/坏数据 503、评价实际保存与重放计一次、响应无私有字段、读取前后业务快照不变，以及完整 Provider 的客户端时钟偏差回归测试。
- `npm.cmd run check`：852/852，lint、类型检查、模块边界通过。最初发现严格 DTO 不能直接接收含关联对象的数据库行，已改为显式提取公共字段，复跑通过。
- `npm.cmd run build` 通过；`npm.cmd run scope -- --role D --base origin/main` 通过，12 个 D 文件；diff 检查通过。
- 实际执行隔离 SQLite 的 `node scripts/run-production-smoke.mjs`：13 页面、32 GET、13 POST 基础场景，以及照片/排期/接单/履约/评价链路均通过。新增公开汇总验证默认 live、mock/live 分开、重放不增样本、无评论/关联 ID、未公开服务方不出现在目录、坏来源明确 503。
- 汇总成功来源取自实际关联记录，没有固定均分 mock；基础资料仍是固定 mock，演示服务方登录和对应接单/评价仍 mock。生产 smoke 的 live 报价仅为合成存储夹具，后续完工与评价通过 HTTP 完成，不代表生产服务方认证或真实履约。
- 合成账号与业务记录、生产测试服务已清理。本轮未做浏览器排序展示验收，B 尚未接新汇总；未修改 A/B/C 业务文件。远端最新提交 CI 及 Production HTTP smoke 结果在 PR 描述中补充。
