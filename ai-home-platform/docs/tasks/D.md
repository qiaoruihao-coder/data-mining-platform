# D：后端、数据底座、AI 封装与集成

## 允许修改
src/contracts/、prisma/、src/lib 中基础设施、除 match/quote 外的 src/app/api/、src/components/ui/、全局布局/样式、依赖与锁文件、CI 与共享文档；tests 中共享测试
精确边界见 docs/OWNERSHIP.md 和 scripts/ownership.mjs。

## P0
先冻结缺失的写入/详情契约，完成需求 CRUD 与真实查询；维护 Prisma 和 seed；实现 LLM 网关的超时、结构化校验与 mock/live 来源。为 A/B/C 提供 api-client 调用函数和一致错误。B 的 match/quote 业务由 B 实现，D 不越界重写。共享变更先单独 PR 合入，让其他三人同步。

## P1（P0 通过再做）
排期依赖/版本/异常变更确认、模拟付款状态机、评价与售后接口。集成最小链路、负责 CI 与演示版本。

## 验收
无 key 可 mock 启动；真实模型失败明确可见；输入校验不放过无效预算；数据库写入/查询一致；金额和状态由程序校验；CI 通过，三位成员 PR 能分别合入。

## 给 AI 的约束
- 读取 AGENTS.md 和 docs/API.md，使用 src/contracts，不自行声明替代 DTO。
- 未归属的文件只读。需要共享改动写 docs/requests/D-主题.md，交对应负责人处理。
- 模块私有样式和组件放自己目录，不改全局主题和依赖。
- 先列本次文件范围，再实现一个小功能，跑检查并交付；不要一次包揽全部 P1。
- 运行 npm run scope -- --role D --base origin/main。

## 本机演练记录
历史已通过记录见各 `docs/requests/D-*.md` 的实际验证；2026-11-15 本轮浏览器及交付检查集中记录于 `docs/requests/D-demo-browser-validation.md`，避免把历史通过数当成本轮结果。

## 鉴权待办（2026-11-14，高优先级）

- [x] `PUT /api/demand/[id]`：同源检查、真实业主凭证预检及写事务内重验；按 id + 当前 userId 过滤并校验可编辑状态，最终 SQL 再限制身份/状态。匿名和失效会话拒绝，跨业主与不存在统一 404；输出验证失败回滚。旧的无鉴权更新入口已移除。见 `docs/requests/D-demand-update-auth.md`。
- [x] `DELETE /api/demand/[id]`：同源检查；同一事务验证实际业主会话、归属、状态和五类关联并删除。最终 SQL 再限制归属/状态/空关联，拒绝匿名与跨业主，演示需求只读。隔离 SQLite 覆盖角色/会话变化、并发修改/删除及失败回滚。见 `docs/requests/D-demand-delete-auth.md`。
- [x] 业主密码登录入口与注销：维护者交互开通新账号，随机盐 scrypt 摘要；POST 验证密码后事务内重验角色/凭证并轮换会话，同源退出撤销 cookie。全局共享登录界面、持久化限频和隔离测试已提供。不支持客户端 userId/角色签发；公开注册、找回密码、MFA 和第三方登录仍未实现。见 `docs/requests/D-owner-login.md`。
- [x] 需求 POST 当前业主归属：同源及会话预检、事务内重验后以当前 userId 创建 published 需求；禁止客户端身份字段，移除固定 demo-owner 入口。公开接口验收登录、创建、修改及本人报价读取，另一业主拒绝。见 `docs/requests/D-demand-create-auth.md`。
- [x] 需求列表/详情隔离：同一事务核验当前身份及 SQL 范围；无业主 cookie 时公开列表仅 published，有效业主列表仅本人所有状态。published 详情公开，非公开仅所属业主可读，其余与不存在统一 404。失效业主 cookie 仍 401，不回退匿名。见 `docs/requests/D-demand-read-auth.md`。
- [x] 排期读取隔离及固定演示例外：无参数或精确 DEMO_DEMAND_ID 可公开读取固定种子排期并标 mock，缺版本 404；带失效业主 cookie 即使演示入口也 401。其他需求在同一事务验证实际业主会话与归属，再读取最新/指定版本，匿名 401，仅服务方 403，他人与不存在统一 404；数据库故障不回退 mock。接入及验证见 `docs/requests/D-schedule-read-auth.md`。
- [ ] 照片检查的真实分析仍为 501；评价 POST/GET 已交付本人已完成接单的保存与读取，见下方评价记录。排期首版创建、工单创建已实现，后续状态流转仍需独立定义和验收，不能将占位响应视为成功。
- [x] `match` 读取审计：发现按 ID 直接读取未公开需求的缺口，已交付 `readMatchingDemand` 及隔离数据库测试；published 公开，其余仅所属业主，同一事务核验会话与读取范围。见 `docs/requests/D-match-read-access.md`。
- [x] B #161 已接入匹配 API/加载器；D 共享生产 HTTP 冒烟增加正常接受报价后实际非公开需求的匿名/他人 404、本人可读和退出凭证 401。其他读取接口仍需逐项审计，最终浏览器联验单独记录。

业主会话与报价读取授权见 `docs/requests/D-owner-quote-read-auth.md`。需求 POST、两个需求 GET、排期读取、服务方实际接单关系和匹配读取权限均已实现；生产服务方认证与管理员专属范围仍未完成，不能宣称整个平台已隔离。

## 成员反馈与后续顺序（2026-11-14）

- [x] PR #81 已合入；README 补充拉取 main 后运行 `npm run db:setup` 的提示，本机已执行成功。该同步保留已有记录，历史报价来源回填 mock。
- [x] 业主密码登录、刷新和退出入口；密码认证是真实实现，账号不代表实名认证。B 的报价读取 API/页面已接入业主授权与来源；当前端到端 HTTP 链路见履约/评价冒烟。
- [x] #95 已合入，#101 公开读取修订已普通合并同步 main dc5d8ef，并重新运行 `npm run db:setup`；检查与生产冒烟结果见 `docs/requests/D-demand-read-auth.md`。后续 D 功能继续依次交付，避免多个 PR 同时修改共享接口文档和需求基础设施。
- [x] C 的服务方身份过滤基础查询：按 `C-provider-orders.md` 允许的最小方案提供 `GET /api/provider/quotes`，复用 Quote[]，在同一事务按实际服务方会话绑定过滤本人报价，拒绝自报身份参数，覆盖匿名/跨服务方/撤销及来源测试。演示身份整体 mock，接线协议见 `docs/requests/D-provider-own-quotes.md`。
- [ ] 生产服务方登录仍未实现；实际接单关系与履约查询已在下方接单记录交付，C 的接单页面已合入。本人报价不等于接单。

这些是后续独立验收项，本次没有改动 B/C 的业务目录，也没有将服务方演示登录转换为业主身份。

## 报价来源基础设施（2026-11-14）

- [x] Quote.source 非空、默认 mock；公共 Quote 可选 source；固定演示报价显式标 mock。
- [x] 持久化来源严格校验、混合/空列表来源汇总；真实旧表升级、回执关联保留和重复同步测试。
- [x] B 已在创建、重放和 GET 中接入持久化来源与汇总工具；GET 已使用业主事务授权，固定演示与实际数据来源区分。旧“等待 #79”的描述不再代表当前状态。

需求 PUT/DELETE 和 GET 的鉴权已单独记录在上方，POST 由 #95 处理。来源实现及数据库同步见 `docs/requests/D-quote-source.md`。

## 未开工排期确认修订（2026-11-14）

- [x] PUT /api/schedule：本人 published/contracted 需求的最新计划全部 pending、未分配责任方时，显式 confirmed=true、校验 baseVersion 后追加下一版；旧版保留且可读，事务内重验、并发保护与失败回滚。见 `docs/requests/D-schedule-revision.md`。不依赖工单 PR #116。
- [x] A 已提供未开工修订表单、版本冲突提示和旧版本读取；源码入口为 ScheduleEditorPanel / ScheduleVersionControls。
- [ ] 提交前差异预览、变更原因/审批审计记录、服务方确认、施工中异常变更与专业验收仍未实现；业主确认保存不代表他人审批或施工承诺。

未开工手工计划的版本追加已完成；下方变更申请/审批及其版本流转待办仍指完整审批流程。

## 排期写入与后续业务（2026-11-14）

- [x] POST /api/schedule 创建首版手工计划：真实业主为本人 published/contracted 且无排期的需求创建 v1；同源、事务内身份/归属重验、依赖图与工期校验、重复/并发保护、输出失败回滚。持久化结果 live，初始工序均 pending，无责任服务方；不是 AI 排期或施工承诺。见 `docs/requests/D-schedule-create.md`。
- [x] A 已在无排期页面接入首版创建表单；未开工修订追加版本与履约工序推进也已提供。
- [ ] 完整变更申请/审批及专业阶段验收待后续，不能把保存手工计划称作审批完成。
- [x] 工单 POST 创建 + GET 按本人需求读取：实际业主、同源、事务重验、open/null 初始值、跨业主隔离与失败回滚；固定演示入口仍 mock。见 `docs/requests/D-ticket-create.md`。live 仅表示报告保存，不表示责任认定或售后完成。
- [x] A 已在需求详情接入 TicketCreatePanel，支持创建及重新读取本人工单；创建报告不代表派单或解决。重复提交不去重，失败后需先读取核实。
- [ ] 工单的管理员/服务方授权、派单/解决状态流转与通知未实现；C 的展示页面不等于这些能力已完成。
- [ ] 照片检查真实分析仍待交付；评价、履约动作和操作记录页面已接入。匹配读取器、B 接线及生产权限冒烟已交付，见演示集成记录。
- [x] #108 已合入；本次接口变化同步修改 scripts/smoke.mjs，交付时确认 CI 的 Production HTTP smoke 成功。

## 接受报价与接单关系（2026-11-14）

- [x] GET /api/order?demandId=…：所属业主在同一事务读取实际接单或明确 null，返回履约/评价所需编号，来源保留、错误不回退空态；无需重放接受报价。契约与 A 接线见 `docs/requests/D-owner-order-read.md`。
- [x] POST /api/order：真实业主同源确认本人 published 需求的 submitted 报价，在事务内重验身份/归属/原始数据并原子签约、接受、建立 ServiceOrder。每需求单一关系，重复同报价返回原关系，竞争报价最多一个成功；保留来源、null 费用和原提交回执。见 `docs/requests/D-quote-acceptance.md`。
- [x] GET /api/provider/orders：当前已验证服务方仅读取本人实际接单；历史 accepted 报价不自动补单。当前演示身份整体仍 mock，逐条保留来源，异常/坏数据不回退成功空态。
- [x] 已接单服务方需求详情：有效会话及本人 ServiceOrder 关系在同一事务核验，签约后可读；匿名和其他服务方仍 404，列表不扩大。见 `docs/requests/D-provider-demand-access.md`。
- [x] 履约推进已在同一事务更新 DemandOrder 与 ServiceOrder，工序动作保留排期版本与操作记录，见下节。
- [ ] 不同幂等键形成多报价是否为预期，由 B 确认业务规则，当前未确认，未擅改报价模块。
- [x] B 接受按钮、C 接单页面与 A 履约动作按钮已接线，正常 HTTP 链路可从接受报价推进至完成和评价。
- [ ] 生产服务方认证、改选/取消、多服务方拆单、真实支付与照片真实分析未实现；模拟付款不等于真实支付。

## 施工照片上传基础（2026-11-14）

- [x] POST /api/inspect/images：当前业主、同源及事务内归属重验，JPEG/PNG 实际解码、旋转去元数据，数量/大小/配额限制，整批原子保存 SQLite，返回 24 小时有效随机引用和 live 来源。
- [x] 过期照片全局配额修复：成功上传事务先回收全库过期行再计数，有效照片保留，失败全部回滚，并发不超额。无公共字段/schema/依赖变更；见 `docs/requests/D-photo-expiry-quota.md`。
- [x] POST /api/inspect：当前业主及需求/引用归属、有效期、摘要校验；未知/跨归属/过期引用 404。mock 模式有效引用返回 200/mock 固定演示提示，live 模式仍 501；不分析像素、不改变业务状态。见 `docs/requests/D-photo-inspection-mock.md`。
- [x] A 上传表单 #134 已合入，复用既有照片结果契约，页面分别显示上传 live 和检查 mock。
- [ ] 真实照片分析、预览/删除管理、后台清理、对象存储与人工复核未实现；评价后端见下节。

## 本人已完成接单的评价（2026-11-14）

- [x] POST /api/review：同源实际业主、事务重验归属/完成状态/accepted 报价关联，每接单一次评价；201 创建、同内容 200 重放、不同内容 409，来源沿用接单，mock 不升级，不改变状态/评分。
- [x] GET /api/review?demandId=…：本人范围、明确空态与错误，历史未绑定/坏关联返回 503。Review.orderId 唯一且保留旧行，source 默认 mock；运行 db:setup 同步。见 `docs/requests/D-review-create.md`。
- [x] A 已在需求详情接入 ReviewPanel，读取本人完成接单并提交/刷新评价；服务方公开均分/样本数聚合也已实现，mock/live 分开。
- [ ] 评价内容公开、审核和通知未实现；公开均分不代表公开评论或质量认证。

## 履约推进与评价连通（2026-11-14）

- [x] POST /api/order/progress：所属业主明确确认，需求与接单原子 contracted→in_progress→completed；不跳级/回退，来源保留，失败全部回滚。
- [x] 有排期时按依赖 start_task/complete_task，追加版本并保留历史；全部 done 才能整单完成。实际操作与当前操作者、状态、结果版本同事务记录。见 `docs/requests/D-order-progress.md`。
- [x] 生产 HTTP 链路改为通过接口开工/逐项完成/整单完成/评价，并读取服务方接单列表和详情，不再直接改数据库模拟 completed。
- [x] GET /api/order/progress?demandId=…：所属业主读取本人已保存操作记录，事务内验证归属与接单关联，保留来源、不公开操作者身份；无记录不补造，坏数据 503。A 页面接线与验证见 `docs/requests/D-order-progress-history.md`。
- [ ] 双方审批、专业验收材料、实际日期、阻塞/返工/施工中变更和付款联动待后续；A 的履约动作按钮 #144 和操作记录展示 #162 已接入。
- [x] 照片检查 mock 结果已提供；过期照片全局配额修复 #136 与业主接单查询 #132 已合入。上传 live 与检查 mock 分开，真实照片 AI 分析仍未接通。
- [x] 回复 B #133 的档期/履约评价请求，确认固定 mock 档期、已完成接单评价均分和样本数、mock/live 分开统计，见 `docs/requests/D-match-ranking-response.md`。
- [x] Provider 可选 source/performance、ProviderPerformance 与 ProviderQuery，以及 GET /api/provider 的评价汇总已交付：公开目录范围不扩大，完成接单的一次评价、均分/样本数、mock/live 分开、无样本 null/0、坏数据 503。共享只读适配器供 B 后续接线，见 `docs/requests/D-provider-performance.md`。
- [x] 固定 mock 档期样例：冻结 `Provider.availability` 公共契约并在六个固定演示服务方中提供明确 mock/未知样例；见 `docs/requests/D-provider-availability.md`。
- [x] 演示报价已能展示单位/列项差异和待确认提示；新增四组合成 completed 接单/评价，mock 查询 provider-a 4.67/3、provider-b 4/1，默认 live 不回退。需求读取保留合成来源；重复 seed 不覆盖已有记录；README 补充样例验收步骤。
- [x] B 档期/评价排序 #153、C 档期展示 #152 已合入；演示档期截至 2026-12-31，答辩更晚须提前更新样例并联验，不能自动延长。
- [x] 已读取 A-ai-live.md，保留“AI 澄清默认是 mock”的仓库说明；本轮演示通过进程环境明确使用 mock，不覆盖本机供应商配置。
- [x] 2026-11-15 真实需求澄清已完成本机生产构建下的完整草稿、缺失预算、补充与纠正四种真实模型调用及浏览器草稿展示；非法 JSON、超时、矛盾输出和 503 另用受控测试验证。CI 保持 mock，其他部署仍须配置供应商并验收，见 `docs/requests/D-demand-chat-live.md`。任一坏评价/关联导致整个目录 503 的限制保留。

## 演示集成（2026-11-15）

- [x] #160 已合入；新增 `docs/DEMO.md` 操作脚本，README 汇总已知限制，并核对本清单的已接入表单和后端状态。
- [x] 先前评估 `B-ranking-demo-data.md` 时，临时数据使 3 条 B 旧断言失败，曾恢复样例等待 B 固定夹具；历史交接见 `docs/requests/D-demo-integration.md`。
- [x] #165 已固定 B 读取协议测试的候选与时间；D 将 a/b 改为同 98 分并交换窗口，补充实际样例和上海 11-22 边界回归。2026-11-15 浏览器实际 live→mock→live 为 b→a、a→b、b→a；11-22 起剩余不足不再保证翻转，见 `docs/requests/D-demo-browser-validation.md`。
- [x] 同步 B #161 后，D 在共享生产冒烟加入“实际存在的非公开需求，匿名匹配返回 404”，并核对其他业主/服务方 404、本人可读及退出凭证拒绝；状态通过正常 HTTP 接受报价产生。
- [x] 隔离库合成账号的浏览器完整链路已完成，覆盖发布至履约、评价、工单及退出拒绝。发现并获用户授权修复 A 确认按钮，独立 PR #168 已合入；完整流程先在包含该修复的本地组合验证，再同步 main 6b708df 检查。自动 HTTP 冒烟与浏览器结果分别记录，见 `docs/requests/D-demo-browser-validation.md`。

## 公共首页清理（2026-11-15）

- [x] 按 `C-home-scaffold-cleanup.md` 将首页开发分工卡片替换为我的装修、报价对比演示、服务方需求大厅、运营看板；保留模拟来源、角色导航与认证边界。核对仓库引用后删除未使用的 `ModulePage.tsx`，不修改 A/B/C 业务模块。实际验证见 `docs/requests/D-home-product-entry.md`。
