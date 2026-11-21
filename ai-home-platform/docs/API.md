# 接口契约 v0.1
字段和校验以 src/contracts/index.ts 为唯一来源。不要从本说明复制类型另建一份。
统一成功结构：
```json
{"ok":true,"data":{},"meta":{"source":"mock"}}
```
统一失败结构：
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"可读错误"}}
```
HTTP：400 输入错误；404 资源不存在；409 状态冲突；501 尚未实现；503 AI 不可用。
金额人民币分；未知金额 null；不得把含未定费用的报价称作最终总价最低。
契约变更必须同步调用方、mock、测试。浏览器读取可使用 `apiGet(path, Schema)`，提交 JSON 可使用 `apiPost(path, body, Schema)` 或 `apiPut(path, body, Schema)`，无请求体删除可使用 `apiDelete(path, Schema)`；失败时客户端保留 `ApiClientError.code/status`。

## 已提供的接口
未特别说明的接口仍返回固定演示数据；需求接口读取 Prisma，匹配接口支持显式 `demandId` 校验。只有文档已记录并通过测试的查询参数才可在调用方使用。
| 方法/路径 | data 对应契约 | 负责 | 当前状态 |
|---|---|---|---|
| GET /api/health | service、stage | D | 可用 |
| GET /api/auth/demo-provider | DemoProviderSession | D | 读取演示会话状态，始终标 mock；默认 disabled |
| POST /api/auth/demo-provider | DemoProviderLoginInput → DemoProviderSession | D | 显式开启后登录固定演示服务方，设置 HttpOnly cookie |
| DELETE /api/auth/demo-provider | DemoProviderSession | D | 同源退出并撤销数据库会话，清除 cookie |
| GET /api/auth/owner | OwnerSessionState | D | 读取业主凭证和当前账户，返回 signed_in / signed_out，不续期 |
| POST /api/auth/owner | OwnerLoginInput → OwnerSessionState | D | 验证密码并在事务内重验凭证/角色，轮换当前浏览器的业主会话 |
| DELETE /api/auth/owner | OwnerSessionState | D | 同源撤销当前会话，成功后清除 cookie，可重复退出 |
| GET /api/demand | Demand[] | D | 无业主 cookie 可公开读取 published；有效业主仅本人所有状态；坏业主凭证 401，不接受查询参数 |
| POST /api/demand | DemandInput → Demand | D | 验证业主会话后写入本人需求，published/live；无会话 401，存储故障 503 |
| GET /api/demand/[id] | Demand | D | 精确 ID 查询；published 公开，非公开限所属业主或有效服务方的实际接单；不可访问/不存在统一 404 |
| POST /api/demand/chat | ChatResult | D | 读取 ChatInput；`AI_MODE=mock` 返回 mock，`AI_MODE=live` 调用服务端 LLM 网关并返回 live |
| GET /api/provider[?performanceSource=live\|mock] | ProviderQuery → Provider[] | D | 固定公开目录的基础资料 mock；已完成接单评价汇总按所选来源查询，缺省 live，无样本 null/0 |
| GET /api/provider/quotes | Quote[] | D | 同一事务验证服务方会话并只查本人报价；当前演示身份整体标 mock，不代表接单 |
| POST /api/order | OrderAcceptInput → OrderSummary | D | 所属业主接受已提交报价，原子建立单一接单关系；首次 201，同报价重放 200，保留报价来源 |
| GET /api/order?demandId=… | OrderQuery → OwnerOrderResult | D | 仅所属业主读取实际接单；OrderSummary 或 null，不重放接受报价，不写业务数据 |
| POST /api/order/progress | OrderProgressInput → OrderProgressResult | D | 业主确认开工/工序/整单完成；需求、接单、排期版本及事件同事务保存，200，来源沿用接单 |
| GET /api/order/progress?demandId=… | OrderQuery → OrderProgressEvent[] | D | 所属业主读取已保存履约动作，隐藏操作者身份；来源沿用接单，无记录不补造 |
| GET /api/provider/orders | OrderSummary[] | D | 同一事务验证服务方并只查本人接单关系；无参数，当前演示身份整体 mock |
| GET /api/match[?demandId=<id>] | Match[] | B | 无参数固定演示；显式 ID 使用受控读取器，published 公开，其他状态仅本人业主，越权/未知统一 404；非法参数 400 |
| GET /api/quote[?demandId=<id>] | QuoteQuery → Quote[] | B | 无参数固定 mock；显式 ID 在事务内核验业主归属，读取本人 submitted/accepted 报价并保留来源 |
| POST /api/quote | QuoteSubmissionInput → Quote | B | 已接演示会话；合法首次提交 201/mock，同键同摘要重放 200/mock；无有效会话 401 |
| GET /api/schedule[?demandId=<id>&version=<n>] | Schedule | D | 无参数或固定 demo-demand 为公开种子排期 mock；其他需求验证业主会话及归属后读取最新/指定版本 |
| POST /api/schedule | ScheduleCreateInput → Schedule | D | 当前业主为本人 published/contracted 且无排期的需求创建 v1；201/live，工序均 pending 且责任服务方为空 |
| PUT /api/schedule | ScheduleRevisionInput → Schedule | D | 业主确认修订本人未开工且未分配责任方的计划，校验基准版本后追加下一版，201/live；旧版保留 |
| GET /api/payment | Payment[] | D | 模拟节点列表；simulated 必须 true |
| GET /api/ticket[?demandId=<id>] | Ticket[] | D | 无参数/精确 demo-demand 返回固定 mock；其他需求仅所属业主可读 |
| POST /api/ticket | TicketCreateInput → Ticket | D | 当前业主为本人已发布及后续状态需求创建 open 工单，责任方 null；201/live |
| POST /api/review | ReviewInput → Review | D | 本人实际已完成接单的一次评价；首次 201，同内容重放 200，沿用接单来源 |
| GET /api/review?demandId=<id> | Review[] | D | 仅所属业主读取，必须显式 demandId；无公开演示入口，坏关联不回退空数组 |
| POST /api/inspect/images | multipart InspectionUploadFields + images → InspectionUploadResult | D | 当前业主上传本人需求的 JPEG/PNG，真实解码去元数据并原子保存，201/live，引用 24 小时有效 |
| POST /api/inspect | PhotoInspectionInput → PhotoInspectionResult | D | 同源、业主及已上传引用校验；mock 模式 200/mock 固定模拟提示，live 模式仍 501，真实 AI 分析未接通 |

## 服务方目录与评价汇总

`GET /api/provider` 只接受可选且唯一的 `performanceSource=live|mock`，缺省 live；空值、未知值、重复和其他参数 400/VALIDATION_ERROR。保持原六个固定演示服务方公开目录，不公开任意数据库服务方。Provider 新增可选 `source`、`availability` 和可选/可空 `performance`，旧 DTO 兼容；本接口返回固定 mock 档期样例和评价汇总。基础资料与档期 source=mock，故整体 meta.source=mock；performance.source 独立表示选择的统计口径，不能用整体来源覆盖逐维度来源。

公共 `ProviderPerformance` 为 `{ basis: 'completed_order_review_average', averageRating: number | null, reviewCount: number, calculatedAt: ISO8601, source }`。仅统计需求与实际接单均 completed、同需求/业主/服务方且 accepted 报价关系一致、评价/接单/报价来源一致的绑定评价。每接单最多一个样本，均分四舍五入到两位（1–5），无样本明确 null/0；不使用旧 Provider.rating 或其他来源补齐。`calculatedAt` 只要求 ISO 8601 datetime 格式，不用浏览器当前时间判断未来，以容忍客户端时钟偏差。无 orderId 旧评价不在口径内；一致但未完成的关系排除；错绑/坏来源/非法评分/存储异常返回整批 503/PROVIDER_UNAVAILABLE，不伪装空样本。公开响应没有评论、业主、需求、接单或评价 ID。

服务端 `readProviderDirectory({ performanceSource: 'live' | 'mock' })` 在 Serializable 事务内生成同一快照时间并返回公共信封，默认参数为 live；HTTP 与 B 的 `/api/match` 已复用，抛错为 `ProviderDirectoryError`。浏览器使用 `apiGet('/api/provider?performanceSource=mock', Provider.array())`，不要导入服务端适配器。所有 HTTP 响应 no-store，不依赖 cookie、不写库或更新服务方 rating。`availability` 的窗口按 Asia/Shanghai 自然日解释，固定样例 source=mock；缺省/null 是未知，空窗口只表示覆盖区间内无窗口，过期后不参与排序。当前任一查询范围内的坏评价或坏关联会让整个目录返回 503：C 的需求页和 B 的匹配页会无法完成目录加载；B 的报价对比页会保留报价，但服务方名称与来源提示待确认。此指标是业主评价均分，不是准时率、质量认证或信用分；少于 3 个样本由调用方显示样本少。

B 排序/来源展示与 `/api/match` 目录接线已随 #153 合入，C 档期展示 #152 已合入，#157 已提供固定演示页的 live/mock 评价选择器，#161 已接入匹配需求权限。固定 mock 档期、报价单位/列项差异样例与四组合成 completed 接单/评价已提供；运行 db:seed 补齐固定记录。仅种子样本时 mock 汇总为 provider-a 4.67/3、provider-b 4/1；默认 live 不回退这些样本。#165 固定 B 测试夹具后，D 已将两候选基础分统一为 98：a 两段 13/16 天，b 单段 31 天。在上海日期 2026-11-15 至 11-21、仅有上述种子评价时，固定演示页 live→mock→live 为 b→a、a→b、b→a；11-22 起 b 剩余不足 30 天，live 回到 a→b。实际浏览器验收见 `docs/requests/D-demo-browser-validation.md`。操作脚本见 `docs/DEMO.md`，字段说明见 `docs/requests/D-provider-performance.md` 和 `docs/requests/D-provider-availability.md`。本次无接口字段或查询参数变化。

## 接受报价与本人接单

`POST /api/order` 接收公共 `OrderAcceptInput`：`{ demandId, quoteId, confirmed: true }`。ID 非空且非纯空白，原样精确匹配；拒绝其他字段、查询参数及超过 4096 字节的正文。真实业主同源确认后，只能首次接受本人非演示 published 需求的 submitted 报价；同一 Serializable 事务重新验证身份、当前角色、归属和原始报价，原子执行需求 contracted、报价 accepted、ServiceOrder 创建。每需求最多一条关系，关联报价唯一；失败或坏输出全部回滚，其他报价和原提交幂等回执保留。

首次 201 `envelope(OrderSummary)`，相同需求和报价的当前授权重放 200 返回原关系，不重复写入；另一报价 409/ORDER_ALREADY_EXISTS。无接单关系时，非 published 需求为 409/INVALID_STATE；published 需求已有旧 accepted 报价为 409/ACCEPTED_QUOTE_CONFLICT，不自动补单。仅支持单需求单服务方；接单关系保存不表示签署法律合同、付款、开工或完成施工。未确定费用/null 原样保留，不能当作零或已确认最终总价。签约后原报价 POST 及原提交回执重放仍受 published 限制。

`OrderSummary` 必含 id、demandId、providerId、acceptedQuoteId、status（contracted/in_progress/completed）及 source。接受报价只创建 contracted；后续通过下节 /api/order/progress 推进，一致的后续状态记录仍可重放读取。来源沿用被接受报价的持久化来源，POST 整体与逐条一致；mock 不因业主点击或落库升级为 live。

`GET /api/provider/orders` 无参数，服务端在同一事务验证当前服务方会话及绑定，再按 providerId 查询实际关系并校验关联需求/accepted 报价；按 ID 升序，不表示时间排序。历史报价不会凭 accepted 状态进入接单列表，只有授权且实际无关系才返回成功空数组。当前固定演示服务方身份让列表整体（含空列表）为 mock，每条保留 source；它不等于生产服务方认证。有效服务方 cookie 优先，与 `/api/provider/quotes` 一致；只有业主会话 403，无/失效/重复/关闭演示或绑定失效为 401，不能靠身份参数或角色头选用户。

写入无效业主会话或仅服务方 cookie 为 401；角色变化/跨源 403；非本人和不存在需求统一 404/DEMAND_NOT_FOUND，确认本人归属后其他需求的报价与不存在报价统一 404/QUOTE_NOT_FOUND。本人演示需求 409/DEMO_DEMAND_READ_ONLY，非法状态 409/INVALID_STATE。读写存储、事务、坏来源/DTO/关联不一致均 503/ORDER_UNAVAILABLE，提示结果暂时无法确认，可对同一报价重试核实。所有成功/失败 private, no-store、Vary: Cookie，不回退 mock 或空成功。

B 使用 `apiPost('/api/order', input, OrderSummary)` 并在明确确认前展示报价、待定费用和来源，成功后刷新报价/需求；C 使用 `apiGet('/api/provider/orders', OrderSummary.array())`，区分本人报价和接单，展示来源及错误。B 的接受按钮与 C 的接单页面已随 #121/#122/#125 合入，履约推进接口见下节；生产服务方认证、改选/取消、多服务方拆单仍未实现。数据库须先运行 `npm run db:setup` 同步新表，seed 不补造关系。详见 `docs/requests/D-quote-acceptance.md`。

## GET /api/order：业主读取本人接单

必须恰好一个非空 demandId；公共 `OrderQuery` 保留原 ID 精确匹配，缺失/空白/重复及其他参数为 400/VALIDATION_ERROR。同一 Serializable 事务核验当前业主会话、角色和需求 ownerId，再读取实际 ServiceOrder，验证需求/接单状态、accepted 报价、服务方和来源一致。公开需求也不公开接单，demo-demand 没有匿名例外，GET 不写数据或补造关系。

200 `envelope(OwnerOrderResult)`，`OwnerOrderResult = OrderSummary.nullable()`：有关系时 data 为摘要（id、demandId、providerId、acceptedQuoteId、status、source），整体来源与接单一致，mock 不升级；确实无接单时 data:null，普通需求为 live、本人固定演示需求为 mock。历史 accepted 报价不自动变成接单；需求已处于 contracted/in_progress/completed 却缺关系则 503，避免掩盖状态损坏。

无/坏/重复/过期/撤销业主 cookie 或仅服务方为 401/UNAUTHENTICATED；当前角色非 owner 为 403/FORBIDDEN；他人与不存在需求统一 404/DEMAND_NOT_FOUND；存储、字段、来源或关联损坏为 503/ORDER_UNAVAILABLE，不回退空态或 mock。双 cookie 以业主为准。所有响应 private, no-store、Vary: Cookie，不含内部身份、会话或报价明细。

A 使用 `apiGet('/api/order?demandId=' + encodeURIComponent(demandId), OwnerOrderResult)`，data.id 用于履约、data.providerId 用于评价；data:null 显示尚无接单，错误保留可见。进入页面及操作/网络异常后可直接 GET 刷新核实，无需为了读取再次 POST 接受报价。前端接线另由 A 完成，详见 `docs/requests/D-owner-order-read.md`。

## POST /api/order/progress：业主确认履约推进

公共 `OrderProgressInput` 为严格动作联合：所有动作必填 demandId、orderId、action、confirmed=true、scheduleVersion（最新排期正整数版本，确实没有排期时显式 null）；start_task / complete_task 另必填 taskId。ID 非空非纯空白、精确匹配；拒绝其他字段/查询参数及超过 8 KiB 的正文。不允许自报身份、状态、责任方或来源。

只有所属业主可同源操作，预检及 Serializable 写事务内重验当前身份、角色、归属；必须有同需求的实际 ServiceOrder，需求/接单状态及 accepted 报价关联、服务方、来源一致。固定 demo-demand 只读；其他 mock 接单可由实际业主推进，来源仍 mock。动作规则：

| action | 允许条件与效果 |
|---|---|
| start | contracted → in_progress，两侧同步；有排期须全部 pending，工序本身不自动开工 |
| start_task | 接单 in_progress；目标 pending、前置全 done，目标改 active |
| complete_task | 接单 in_progress；目标 active、前置全 done，目标改 done，表示业主确认完成 |
| complete | in_progress → completed，两侧同步；有排期须最新工序全部 done，无排期仍须显式确认 |

工序动作保留计划/责任方字段，仅追加下一版排期，旧版本不覆盖；最大数据库版本不可再追加。责任方须为空或当前接单服务方，blocked/返工不能借此绕过。程序校验原计划依赖图及 active/done 的前置完成状态；坏数据 503，不修复后伪装成功。

最终写入再次限制归属、两侧旧状态、原报价内容和最新排期快照（包括无排期）；条件更新需求、接单，必要时追加排期，并保存 OrderProgressEvent。事件含当前 actorId、动作、前后状态、工序、结果版本及服务端时间；任何写入/输出校验失败全部回滚。返回 200 `envelope(OrderProgressResult)`：`{ order: OrderSummary, schedule: Schedule | null }`，meta.source 沿用接单，不返回内部操作者信息。不会改报价金额/待定费用、付款或服务方评分。业主确认不等于专业验收、照片 AI 判断或实际付款。

scheduleVersion 必须与当前最新值一致，包括 null；旧值 409/SCHEDULE_VERSION_CONFLICT。当前授权与版本有效时，start 已处于 in_progress、complete 已处于 completed、工序已处于目标状态可返回当前 200，不重复事件。工序首次推进增加版本，原请求重放为 409；刷新核实后由用户重新决定动作，不能自动更新版本重发。已完成后不能退回施工中；并发最多一次实际变更，失败可能为 409 或中性 503。

无/坏/重复/过期/撤销业主 cookie 或仅服务方 401/UNAUTHENTICATED，角色/同源失败 403/FORBIDDEN；他人与不存在需求统一 404/DEMAND_NOT_FOUND；本人需求缺目标关系或错误 orderId 为 404/ORDER_NOT_FOUND，未知工序 404/TASK_NOT_FOUND。跳级/回退 409/ORDER_PROGRESS_NOT_ALLOWED，计划状态/责任方/版本上限不支持 409/SCHEDULE_PROGRESS_NOT_ALLOWED，工序状态/依赖不支持 409/TASK_PROGRESS_NOT_ALLOWED，计划未全完成 409/SCHEDULE_NOT_COMPLETE。存储/关联/坏数据/竞争不确定结果为 503/ORDER_PROGRESS_UNAVAILABLE，需先刷新核实。所有响应 private, no-store、Vary: Cookie。

A 用 `apiPost('/api/order/progress', input, OrderProgressResult)` 接线，展示动作、当前版本、来源并取得用户确认，之后刷新需求与排期；C 的接单列表/详情会读到一致的新状态。接受报价→开工→（有排期逐项推进）→确认完成→评价已可通过正常 API 走通，生产冒烟不再直接修改完成状态。服务方申请/双方审批、专业验收材料、实际日期、阻塞/返工/施工中变更和付款联动仍未交付；本人事件查询见下节。数据库先 `npm run db:setup` 同步操作记录表，见 `docs/requests/D-order-progress.md`。

## GET /api/order/progress：本人履约操作记录

A #162 已在非演示需求的最新施工排期页接入 OrderProgressHistory；显示动作、状态、记录时间、工序/排期版本与逐条来源，支持手动刷新，履约动作成功后也会刷新。指定旧排期版本时不展示该记录面板。错误不会伪装为空列表，历史记录不表示专业验收或付款。

复用严格的公共 `OrderQuery`，必须恰好一个非空 demandId，保留原值精确匹配；缺失、空白、重复或其他参数为 400/VALIDATION_ERROR。无匿名演示入口。同一 Serializable 事务验证当前业主会话与角色、需求 ownerId、实际接单及 accepted 报价关联，再用 orderId、demandId 和当前 ownerId 过滤事件。

成功 200 `envelope(OrderProgressEvent[])`，每条含 id、orderId、action、fromStatus、toStatus、taskId、scheduleVersion、createdAt 和 source。无工序/排期分别显式 null；工序动作必须有 taskId 和至少为 2 的结果版本。合法动作组合与现有 POST 一致，不允许跳级记录或与当前接单状态矛盾的完成记录。createdAt 是服务端保存动作的 ISO 8601 时间，按时间升序、同时间按 id 升序稳定排序；同毫秒 ID 排序不表示实际执行先后。

逐条及整体来源沿用已验证的接单，mock 不升级。已有接单但没有事件时返回空数组，不为种子或历史接单补造操作；本人 draft/published 需求无接单时也为空，来源沿用需求。后续状态缺接单、坏事件/来源/关联或存储失败为 503/ORDER_PROGRESS_UNAVAILABLE，不能过滤后伪装空态。查询不推进业务状态、不写事件，不保证历史记录完整性。只选公开事件字段，不读取事件 actorId，响应不包含姓名、凭证或报价明细。

无/坏/重复/过期/撤销业主 cookie 或只有服务方 cookie 为 401/UNAUTHENTICATED，当前账号非 owner 为 403/FORBIDDEN；他人与不存在需求统一 404/DEMAND_NOT_FOUND。双 cookie 仍业主优先。全部响应 private, no-store、Vary: Cookie。A 使用 `apiGet('/api/order/progress?demandId=' + encodeURIComponent(demandId), OrderProgressEvent.array())`，按来源展示并保留错误；页面接线另由 A 完成。记录只表示业主确认，不等于专业验收、付款或 AI 判断。无 schema/依赖变化，交接与验证见 `docs/requests/D-order-progress-history.md`。

## 已完成接单的评价

`POST /api/review` 读取严格的公共 `ReviewInput`：demandId、providerId、rating、comment。ID 非空且非纯空白，原样精确匹配；rating 为 1–5 整数，comment 去首尾空白、最多 2000 字符，可留空只评分。拒绝额外字段、查询参数及超过 16 KiB 的正文。客户端 providerId 仅用于核对目标，不能自报身份、接单、来源或状态。

同源及实际业主会话预检后，在 Serializable 事务重验同一身份、当前角色及本人需求归属。只允许非演示需求与实际 ServiceOrder 均为 completed，且 accepted 报价、需求、服务方、状态、来源全部一致时创建。最终写入再次限定归属、两方完成状态、原报价内容及空评价；输出校验失败回滚。仅有 accepted 报价没有接单不能评价，需求公开也不授予评价权。

首次 201 `envelope(Review)`，包含 id、demandId、orderId、providerId、rating、comment、source。每接单一条，数据库唯一约束；当前授权下相同分数与规范化评论重放返回原记录 200，不重复写入；不同内容 409/REVIEW_ALREADY_EXISTS，不覆盖。并发失败可能为 409 或中性 503，先 GET 核实。评价来源沿用接单和 accepted 报价，mock 不升级为 live；live 只表示实际保存，未核实评论事实。不会推进施工/付款状态或更新服务方聚合评分，无修改/删除接口。

`GET /api/review?demandId=…` 必须恰好一个非空 demandId，拒绝其他/重复参数。在同一事务验证业主、归属与接单关联，返回 `Review[]`。确实无评价返回空数组/live（本人固定演示需求空数组为 mock）；有评价则逐条及整体保留来源。不存在公开演示评价或匿名/服务方/管理员入口。旧评价缺 orderId、来源/字段损坏、重复旧行或关联不一致均 503，保留原数据，不过滤后伪装成功空态。

无/失效/撤销/重复/过期业主 cookie 或仅服务方 cookie 为 401/UNAUTHENTICATED，角色改变/跨源为 403/FORBIDDEN；他人与不存在需求统一 404/DEMAND_NOT_FOUND。本人固定演示需求 POST 为 409/DEMO_DEMAND_READ_ONLY；无接单或未完成为 409/REVIEW_NOT_ALLOWED，目标服务方不符为 409/REVIEW_PROVIDER_MISMATCH；存储、事务或坏数据为 503/REVIEW_UNAVAILABLE。所有成功失败 private, no-store、Vary: Cookie，失败无 data/meta。

更新后运行 `npm run db:setup` 同步 Review.orderId 唯一可空关联及 source（默认 mock）；可空仅保留历史记录，新写入必有实际关联，不自动将旧行补造成真实评价。A 已在需求详情接入 ReviewPanel，使用公共 Review 提交并读取本人评价，显示来源并对已存在/错误先核实。公开目录的评价均分/样本数聚合也已实现，mock/live 分开；评论内容公开、审核与通知尚未实现。正常 API 已可通过 /api/order/progress 达到 completed，不需要直接改库。详见 `docs/requests/D-review-create.md` 及履约交接。

## 工单创建与读取

`POST /api/ticket` 仅接收公共 `TicketCreateInput`：demandId、description、category。ID 非空且非纯空白，保留原值精确匹配；描述去首尾空白后 1–4000 字符；分类复用 quality/schedule/payment/attitude。拒绝所有额外字段（包括身份、id、状态、责任服务方和来源），正文最多 16 KiB，不接受查询参数。

同源写入先校验实际业主会话，再于事务外读取正文；Serializable 写事务重验同一身份、当前角色、需求归属/状态。仅本人非演示需求的 published/contracted/in_progress/completed 可创建，draft 不可。最终 SQL 同时限制 ID、ownerId 和当前状态，输出在提交前校验、失败回滚。成功 201 `envelope(Ticket)`/live，服务端生成 ID，status=open、responsibleProviderId=null，不改变需求状态。live 只表示业主报告实际落库，不表示投诉属实、责任认定、派单、通知或售后完成。没有幂等键/内容去重，重复提交会创建独立工单；网络错误或 503 后先读取核实，不能自动重报。

`GET /api/ticket?demandId=…` 仅接收恰好一个非空 demandId，拒绝未知/重复参数。在同一事务验证实际业主和需求归属，再按需求及当前 ownerId 查询 Ticket[]，按 id 升序（不表示时间顺序）；本人所有状态均可读，确实无工单为 200/live 空数组。他人与不存在需求统一 404/DEMAND_NOT_FOUND。公开需求详情不授予工单读取权限。

无参数或精确 demo-demand 返回固定种子工单/mock，不读取可变数据库记录。存在业主 cookie 时仍需验证：坏/重复/过期/撤销均 401，角色变更 403，不回退匿名。无参数不会列出当前业主或全站的真实工单，C 现有管理演示页保持固定 mock。

读写缺失/失效业主凭证、只有服务方凭证均为 401/UNAUTHENTICATED；当前账户角色不是 owner 或非同源写入为 403/FORBIDDEN。本人固定演示需求写入 409/DEMO_DEMAND_READ_ONLY，非法状态 409/INVALID_STATE；JSON/字段错误 400。数据库/事务/坏 DTO 返回中性 503/TICKET_UNAVAILABLE，不回退 mock 或空成功。所有响应 private, no-store、Vary: Cookie。A 已接入 TicketCreatePanel，使用共享 `apiPost(..., Ticket)` / `apiGet(..., Ticket.array())` 创建、重读并显示来源；管理授权、派单/解决、通知尚未实现。详见 `docs/requests/D-ticket-create.md`。

## GET /api/schedule

无查询参数或 demandId 精确等于已有 DEMO_DEMAND_ID（demo-demand）时返回与 seed 共用的固定演示排期并标 mock，不读取数据库内同 ID 的可变排期。带不带 version 均无需登录；固定排期当前版本为 1，指定其他合法版本返回 404/SCHEDULE_NOT_FOUND。不能按需求 published 状态或来源 mock 放开其他 ID。显式查询使用公共 ScheduleQuery：恰好一个非空 demandId、至多一个十进制正整数 version；拒绝未知/重复/身份参数和超出数据库整数范围的版本，非空 ID 原样精确匹配。

演示入口没有业主 cookie 时直接返回固定数据，服务方身份不限制演示访问；只要带业主 cookie，仍先验证持久化会话，伪造/重复/过期/撤销返回 401，当前账号不再是业主返回 403，不回退匿名。这同时适用于无参数及显式 demo-demand。有效业主无需拥有演示需求。

其他需求在同一 Serializable 事务核验实际业主 cookie、有效期/撤销、当前角色及需求归属，再读取最新或指定版本。缺失/失效业主凭证为 401；当前非业主角色或只有有效演示服务方凭证为 403。有效业主 cookie 优先，失效或重复业主凭证不回退其他身份。本人需求各状态均可读取；真实需求详情公开不代表排期也公开。

他人与不存在的非演示需求统一 404/DEMAND_NOT_FOUND；确认本人需求后，缺少排期或指定版本才返回 404/SCHEDULE_NOT_FOUND。存储、事务、DTO 或返回归属/版本校验失败为 503/SCHEDULE_UNAVAILABLE，不回退演示。所有读取响应 private, no-store、Vary: Cookie。普通数据库排期沿用 live，不代表真实施工或 AI 排期。A 可沿用 apiGet(..., Schedule)，真实需求在共享业主登录后刷新/重试，演示排期始终显示 mock；接口与验证见 `docs/requests/D-schedule-read-auth.md`。首版写入见下节。

## POST /api/schedule：首版手工计划

输入仅为公共 `ScheduleCreateInput`：demandId 和 1–100 项 tasks，每项含 id、name、startDay、durationDays、dependsOn。工序 ID 唯一，依赖不能重复、自引用、缺失或成环，开始日不得早于依赖结束；独立任务可并行。天数为符合数据库整数范围的非负开始日与正工期，结束日不能溢出；ID 精确匹配、名称去首尾空格。正文最多 64 KiB，顶层及工序均拒绝未知字段，客户端不能指定身份、来源、版本、状态、责任服务方或验收结论。

仅同源 POST，无查询参数；真实业主会话预检后在事务外读正文，再在 Serializable 写事务重验当前会话、账户角色和需求归属。只允许本人非演示需求在 published/contracted 且尚无任意版本排期时创建；最终嵌套写入仍限定 ID、ownerId、当前状态及空排期，输出校验失败回滚。成功 201 `envelope(Schedule)` / live，固定 version=1，所有工序 status=pending、responsibleProviderId=null；live 表示实际保存手工计划，不代表真实施工或 AI 生成，需求状态不改变。

无/失效/撤销/重复/过期业主 cookie 为 401，只有演示服务方 cookie 同样 401，当前账户角色不符或同源失败为 403；非本人和不存在需求统一 404/DEMAND_NOT_FOUND。确认归属后，固定演示需求 409/DEMO_DEMAND_READ_ONLY，不可创建状态 409/INVALID_STATE，已有任何版本 409/SCHEDULE_ALREADY_EXISTS。重复请求不覆盖、不追加版本，应通过 GET 核实；事务/数据库冲突或坏输出为中性的 503/SCHEDULE_UNAVAILABLE，不宣称一定未保存。所有响应 private, no-store、Vary: Cookie；坏 JSON 400/INVALID_JSON，非法字段、正文超限或依赖 400/VALIDATION_ERROR。

A 已在无排期页面接入首版创建表单，用 `apiPost('/api/schedule', input, Schedule)` 保存后刷新现有 GET。未开工计划的确认修订与版本追加见下节 PUT；工序状态推进由 `/api/order/progress` 提供。施工中变更审批、责任方分配与专业阶段验收尚未交付。首版字段及接入说明见 `docs/requests/D-schedule-create.md`。

## PUT /api/schedule：确认修订未开工计划

新增公共 `ScheduleRevisionInput`：demandId、baseVersion、confirmed、tasks。baseVersion 是当前最新版本，必须为小于 SQLite Int 上限的正整数；confirmed 必须显式 true。其余字段和依赖图复用首版创建规则，完整提交 1–100 个工序；请求体上限 64 KiB，拒绝查询参数及任何额外字段（身份、目标 version、状态、责任方、来源等）。旧版工序可以在新版增删/改名/调整工期，旧版记录不变。

同源及实际业主预检通过后，事务外读取正文；Serializable 写事务重验同一身份、当前账号角色、需求归属/状态与最新排期。仅本人非演示 published/contracted 需求，且最新计划全部 pending、responsibleProviderId=null 可修订；已开工/完成/阻塞或已有责任方的工序不能被重置。最新计划同时经过公共字段、版本范围与依赖图校验，坏数据返回 503，不能以修订掩盖。

baseVersion 与最新版本不符返回 409/SCHEDULE_VERSION_CONFLICT；页面必须刷新比较并重新确认，不能自动换版本重发。最终写入再次限定需求归属/状态、原计划 ID/版本/内容及无更新版本，只追加下一版，不覆盖历史；输出校验失败回滚。同基准版本并发最多成功一个新版，其余 409 或 503。成功 201 envelope(Schedule)/live，version=baseVersion+1，工序均 pending 且责任方为空，需求状态不变；live 仅表示保存手工计划，confirmed 不代表他人审批或验收。

无/坏/重复/过期/撤销业主 cookie 或仅服务方 cookie 返回 401；角色不符、身份中途变化或同源失败 403；他人与不存在需求统一 404/DEMAND_NOT_FOUND。本人需求无初版为 404/SCHEDULE_NOT_FOUND；本人演示需求 409/DEMO_DEMAND_READ_ONLY，非法需求状态 409/INVALID_STATE，最新计划已有施工状态/责任方 409/SCHEDULE_REVISION_NOT_ALLOWED。JSON/字段错误 400，数据库、事务竞争或坏输出为中性 503/SCHEDULE_UNAVAILABLE，需 GET 核实结果。所有响应 private, no-store、Vary: Cookie。

调用使用 `apiPut('/api/schedule', input, Schedule)`，现有 GET 仍支持最新及指定历史版本。A 已提供修订表单、版本冲突提示和指定旧版本读取；提交前差异预览、变更原因/审批审计记录、施工中异常变更、服务方确认及专业验收仍未实现。工序状态推进由 `/api/order/progress` 提供，A 的履约动作按钮也已接入。完整字段和验收见 `docs/requests/D-schedule-revision.md`。

## GET /api/provider/quotes

无参数的本人报价列表，任何查询参数为 400；不能传 providerId 指定身份。使用现有服务方演示登录，在同一事务核验会话、当前角色与绑定，只查询绑定 providerId 的持久化 Quote，逐条重验归属和公共契约。返回本人 draft/submitted/accepted/rejected 报价，按 id 升序（不表示提交时间或成交顺序），不暴露内部幂等字段及业主资料。

匿名/失效/撤销/过期/重复凭证、演示关闭或账号绑定变化为 401；只有业主身份为 403。存储故障或 JSON/来源/DTO 损坏为 503，不回退固定 mock 或成功空数组；鉴权成功且确实无本人报价才返回空数组。所有成功与失败响应 private, no-store、Vary: Cookie。

逐条 source 保留持久化来源且严格校验，null 费用不当作 0；当前会话为演示服务方，整体 meta.source 始终 mock（含空数组及单条 live 的情况）。这提供“本人报价”，不创建或证明接单关系；实际接单须读已实现的 `GET /api/provider/orders`，C 接单页面已接入。生产服务方登录仍未交付。报价接线说明见 `docs/requests/D-provider-own-quotes.md`，页面修改由 C 维护。

## POST /api/quote

PR #74 已将 `handleQuoteSubmission` 的默认预检及事务会话 reader 接入 `readDemoVerifiedSession`。显式开启演示认证、准备固定账号后，同源有效 cookie 可对非演示、published 的数据库需求提交合法报价：首次 `201`，同键同摘要且当前授权仍有效的重放 `200`，两者均为 `ok: true`、`meta.source: mock`。首次报价及幂等回执各新增一条，重放返回原报价且不重复写入。无有效会话仍返回 `401 UNAUTHENTICATED`，不写入；生产认证未接入，落库不把演示身份变为真实身份。

当前处理顺序及处理器语义：

- 身份预检优先；无会话 401，非服务方或未绑定服务方 403。认证失败不消费请求体、不查询需求。
- 通过预检后校验 `Idempotency-Key`（16–128 位 ASCII 字母、数字、`-`、`_`），缺失/非法为 `400 VALIDATION_ERROR`；再校验 JSON、公共 `QuoteSubmissionInput` 和整数计价。输入仅为 `demandId`、1–20 行 `items`、`estimatedDays`，禁止客户端指定身份、行合计、总额或状态。
- 数量按千分之一整数缩放，逐行用整数乘法并四舍五入到分后求和；金额和工期在持久化边界校验 SQLite Int 范围。不得用浮点乘法替代。
- 同一事务内重新验证会话/绑定 → 检查当前服务方的回执摘要 → 读取需求并验证写入权限 → 原子提交或重放。首次成功 `201 envelope(Quote)`，同键同摘要且当前授权有效时重放原报价 `200 envelope(Quote)`；不同摘要为 `409 IDEMPOTENCY_CONFLICT`。
- 明确的 P2034/P2002 冲突耗尽重试后为 `503 DATABASE_UNAVAILABLE`；其他无法可靠分类的异常（含提交后确认丢失、坏数据库输出）为 `500 INTERNAL_ERROR`。结果未知时保留原键与原输入，不能自动换键重报，也不能宣称此前一定未保存。

完整决策见 `docs/requests/D-quote-idempotency.md`、`docs/requests/D-demo-provider-session.md`。已用实际演示 cookie 和隔离 SQLite 验证公开 POST；业主 GET 和报价页面已接通本人持久化报价读取，当前生产 HTTP 冒烟覆盖登录、报价、接受、履约与评价。自动 HTTP 验证不等于浏览器手工验收。

## 已实现部分与仍返回 501 的能力
- POST /api/inspect 的真实分析由 D 后续完成：照片已可通过 /api/inspect/images 上传，mock 模式校验身份和引用后返回明确模拟结果；live 模式仍 501。POST/GET /api/review 已实现本人已完成接单的评价保存/读取，履约推进由 /api/order/progress 提供。POST /api/schedule 已实现首版计划创建，PUT /api/schedule 已实现未开工计划确认修订，POST /api/ticket 已实现业主创建工单，见上节；施工中变更、专业验收、工单派单与解决仍未实现。
- POST /api/payment：已实现最小模拟确认动作，不做身份校验，任何调用方都可触发演示状态转换。输入为 `PaymentActionInput`，只允许 `pending → confirmed_demo` 一次转换；状态只保存在服务进程内，进程重启后恢复初始演示状态。成功返回 `Payment`，`meta.source` 为 `mock` 且 `simulated` 为 `true`；这不是支付接口，不代表真实付款、资金托管或数据库持久化。
- 单需求详情 GET /api/demand/[id] 已建立；A 可使用返回的 ID 查询，未知 ID 返回 404。

### POST /api/inspect/images 与 POST /api/inspect

上传使用同源 multipart/form-data，恰好一个文本 demandId 和同名 images 的 1–10 个 File，不接受其他字段及查询参数。公共 `InspectionUploadFields`、`InspectionUploadedImage`、`InspectionUploadResult` 与 `INSPECTION_UPLOAD_LIMITS` 是字段/限制唯一来源。真实业主会话预检后限长读取正文，事务内验证本人非演示、非 draft 需求，事务外解码，最终事务重验身份/角色/归属/状态和配额，再条件嵌套保存整批照片；任一失败不保留部分结果。

仅 JPEG/PNG，MIME 与实际格式必须一致；拒绝空、损坏、动画/多页、SVG 及批内原内容或标准化后重复的图片。每张输入/输出最多 2 MiB，整批各最多 10 MiB，整个 multipart 正文最多 11 MiB；单边 4096，像素 1600 万。按照 EXIF 方向旋转、重编码并移除元数据，不保存原图/文件名。进程最多两个上传在处理，单图原生处理设 5 秒超时（不含等待线程的时间）。

成功 201 `envelope(InspectionUploadResult)`/live，data 为 `{ demandId, images: [{ imageRef, contentType, sizeBytes, width, height, expiresAt }] }`。随机 `inspect-image/<UUID>` 引用 24 小时有效，不是公开 URL；大小/尺寸对应实际保存的照片。二进制、SHA-256、ownerId 和 demandId 存 SQLite；live 仅表示保存成功，不表示分析或验收。每业主最多 50 张/50 MiB 有效照片，数据库最多 5000 条/500 MiB 记录。过期引用立即拒绝；后续上传在最终授权通过的同一事务先删除全库 expiresAt <= 服务端 now 的记录，再统计实际剩余配额并保存，失败时清理与新增全部回滚，有效照片保留。不返回其他业主引用或清理计数，无后台清理、文件立即缩小或到期物理擦除保证。需求删除级联删除临时照片，原有业务关联仍限制删除。无上传幂等键，重传产生新引用并计入配额。见 `docs/requests/D-photo-expiry-quota.md`。

检查继续使用公共 `PhotoInspectionInput`：demandId 加 1–10 个不重复 imageRefs，JSON 最多 32 KiB，不接二进制、身份或业务状态。必须使用上传回执中的引用；同一事务校验当前业主、需求、每个引用的归属/有效期/存储摘要，不下载客户端 URL。文件名、未知/过期/跨需求/跨业主引用统一 404/IMAGE_NOT_FOUND；非本人/不存在需求统一 404/DEMAND_NOT_FOUND。任意引用失败即整批拒绝，不返回部分结果。

全部引用有效后：`AI_MODE=mock`（未设置时默认 mock）返回 200 `envelope(PhotoInspectionResult)`/mock；按输入顺序每个引用一条固定提示，明确“【模拟】未分析照片内容”，severity=low 仅演示字段。`reviewedAt` 是服务端生成模拟结果的时间，disclaimer 为公共固定免责声明。结果不持久化，不调用模型、不自动更新业务状态。上传 live 不能提升检查来源。`AI_MODE=live` 仍 501/NOT_IMPLEMENTED，其他值 503/INSPECTION_UNAVAILABLE，均为无 data/meta 的失败信封，不回退 mock。

两个接口均拒绝匿名、坏/重复/撤销/过期会话和仅服务方身份（401）；非同源或当前角色不符 403；演示/非法需求状态 409；坏 JSON、字段、文件或超限正文 400；配额 409/IMAGE_QUOTA_EXCEEDED，繁忙 429/IMAGE_UPLOAD_BUSY；数据库、坏 DTO/摘要或结果不确定 503/IMAGE_STORAGE_UNAVAILABLE。所有响应 private, no-store、Vary: Cookie。接口不回退 mock。

A 的 #134 已接线：先 fetch FormData，勿手写 Content-Type，再用公共 envelope 校验上传结果；apiPost 仅适用于第二步 JSON，页面分别显示上传和检查来源。文件名不是合法已上传引用。真实分析未实现，501 不能显示分析成功或验收通过。预览/删除管理、对象存储、生产保留策略和人工复核未实现。首次部署照片上传需 npm ci、npm run db:setup 后重启，不 reset 数据库；本次 mock 检查无 schema/依赖变化。详见 docs/requests/D-photo-inspection-mock.md。

## 报价历史回执的当前限制

幂等重放成功的前提是当前事务中的身份、账号绑定和需求授权均通过。`live`、`published`、非演示需求的同键同摘要重放才可返回原报价；需求进入 `contracted`、`in_progress`、`completed` 或变为 `draft` 后，同摘要重放仍返回 `409 INVALID_STATE`，不返回历史回执、不新建或修改记录。此拒绝不表示上一次未保存，客户端不能自动换键重报。同键不同摘要仍优先返回 `409 IDEMPOTENCY_CONFLICT`；需求不存在为 404，身份失效/权限变化为 401/403。

以上规则已由写入内核执行；公开 `POST /api/quote` 已接入演示会话，首次和重放成功均标 mock，当前授权失效仍拒绝。历史幂等回执读取接口未开放；`GET /api/quote` 无参数为固定 mock，显式需求查询已提供独立的业主比较列表读取，不改变 POST 重放限制。完整顺序见 `docs/requests/D-quote-idempotency.md`。

## GET /api/quote?demandId=：本人持久化报价读取

当前 GET 已通过 `handleQuoteRead` 接入公共 `QuoteQuery`、`authorizeOwnerQuoteRead` 和 `readStoredQuoteComparison`；B 的页面也已读取本人持久化报价。固定公开演示页使用无参数 mock 入口；显式 `demandId=demo-demand` 仍执行归属校验，不因同名演示 ID 而公开数据库报价。

当前执行规则：无参数保留固定 mock；显式查询仅接受单一非空 demandId，拒绝纯空白、重复和未知参数，非空 ID 原样精确查找。仅当前已验证的业主可读取数据库 `DemandOrder.ownerId === session.userId` 的需求；服务方（含演示 provider-a）和管理员不能取得业主报价比较权限。

显式查询按参数 400 → 会话 401 → 当前账户/角色 403 → 归属查询的顺序处理。有效业主查询不存在或不属于自己的需求统一返回 `404 DEMAND_NOT_FOUND`，不区分两者，避免透露资源是否存在。凭证、撤销、账户和归属均须在同一事务核验；请求头或参数中的自报身份不参与授权。

业主可读取本人需求在 draft、published、contracted、in_progress、completed 各状态下的 submitted/accepted 报价；不返回 draft/rejected 报价。存在且无可比报价为 `200 envelope(Quote[])` 空数组，不能把查询失败变成空数组。数据库或数据校验失败为 `503 DATABASE_UNAVAILABLE`，不回退 mock。显式查询所有成功和失败响应均带 `Cache-Control: private, no-store`、`Vary: Cookie`，禁止共享缓存。来源同时考虑需求及持久化报价：只有需求与所有返回报价都为 live 才标 live，混入 mock 或缺省来源即标 mock；空列表沿用已验证的需求来源。B 已在读写适配中接入来源工具，非法持久化来源会失败，不会降级为 mock。服务方资料仍独立标识来源，详见 `docs/requests/D-quote-source.md`。

参数细节、错误优先级和服务端适配器约束见 `docs/requests/D-quote-read-protocol.md`；该请求中的历史待办以此处当前实现状态为准。

### B 可调用的业主读取入口

从 `@/lib/server-auth` 导入 `parseQuoteQuery`、`readOwnerVerifiedSession`、`authorizeOwnerQuoteRead`、`OwnerAccessError`、`ownerAccessFailureResponse`、`QUOTE_READ_RESPONSE_HEADERS`。`parseQuoteQuery(URLSearchParams)` 仅在无参数时返回 null；非法显式查询抛 400，不回退演示数据。显式查询把 `authorizeOwnerQuoteRead` 直接传给 B 的 `readStoredQuoteComparison`，由 B 内核传入当前 tx；授权器成功返回 true，拒绝抛出带 status/code 的 OwnerAccessError。禁止注入预检身份快照。

`readOwnerVerifiedSession(request, tx)` 必须接收事务客户端。它读取 `__Host-ai_home_owner_session` 的随机凭证，在 OwnerSession 表比对 SHA-256 摘要、到期与撤销状态，再检查当前账户。无效凭证返回 null；当前角色不符抛 403，数据库异常抛 503。授权器将 null 映射为 401；只有有效服务方演示 cookie 时返回 403，不转换为业主。有效业主 cookie 优先，存在但无效/重复的业主 cookie 不回退其他身份。授权器只允许 GET/HEAD，不能用于需求修改/删除。

OwnerSession 的服务端签发/撤销函数仅由 D 内部认证代码使用，不从 server-auth 暴露，也不提供按 userId 直接签发的接口。`POST /api/auth/owner` 验证密码后，在写事务内重新核验当前凭证和 owner 角色，再签发随机 256 位 cookie。Cookie 使用 `__Host-ai_home_owner_session`、HttpOnly、Secure、SameSite=Strict、Path=/，绝对有效期 30 分钟，数据库仅存摘要。业务读取器和授权器签名不变，继续在调用方事务中校验。基础设施记录见 `docs/requests/D-owner-quote-read-auth.md`，登录协议见下节。

### 业主密码登录

`OwnerLoginInput` 仅为 `{login,password}`：账号 3–64 位 ASCII 字母、数字或 `._-`，去除首尾空白并转小写；密码 15–128 字符，保留原值。未知字段一律拒绝。正文最多 4096 字节，非法 JSON/字段或超大正文统一 400/VALIDATION_ERROR。账号由维护者交互运行 `npm run owner:create` 开通，只创建新 owner；没有公开注册、默认密码或自动接管演示账号。

POST/DELETE 强制同源 Origin，缺失/跨源或 cross-site 返回 403/FORBIDDEN；所有三种方法仅支持 HTTPS 或 localhost/127.0.0.1/[::1] 的本地 HTTP。不会因 forwarded 头降低检查。成功 `envelope(OwnerSessionState)` 标 live：`{status:"signed_out"}` 或 `{status:"signed_in",identity:OwnerIdentity,expiresAt:"ISO 8601"}`；cookie/密码/摘要不进入 JSON。所有响应 `Cache-Control: private, no-store` 和 `Vary: Cookie`。

密码使用随机盐的 scrypt 摘要，未知账号执行同等密码计算。错误密码、未知账号、当前角色不符及验证期间凭证变化均返回相同 401/INVALID_CREDENTIALS。每账号只统计认证失败，15 分钟最多 5 次失败，第六次起限流；成功不计数且原子清空该账号失败历史，未知账号规则相同，重启不清零。已移除全局 60 次锁定，一个账号不会耗尽其他账号的登录额度；新版 failure: 键不继承旧版包含成功次数的锁定。超限或进程密码计算繁忙为 429/RATE_LIMITED，带 Retry-After，繁忙只需短暂重试且不计失败。存储或摘要错误为 503/SESSION_UNAVAILABLE，不暴露内部异常，不声称已登录或退出。详见 `docs/requests/D-owner-login-throttle.md`。

POST 在事务外计算密码，再在写事务重读凭证和角色，撤销此浏览器的旧业主会话并签发新凭证；签发失败回滚撤销。GET 读取当前账户，不续期；无效/重复/过期/撤销凭证或账户不再是 owner 时显示 signed_out。DELETE 可幂等退出，存储撤销成功后才清 cookie；服务方演示会话独立保留。浏览器已使用临时合成账号验收错误密码、登录、刷新、本人需求编辑、退出后编辑被拒绝；这不是实名认证，也不代表其余业务访问控制已补齐。

## 服务端身份基础设施

报价服务端可通过 `src/lib/server-auth.ts` 的 `requireProviderIdentity(request, readSession)` 取得当前服务方身份。`readSession` 必须是服务端已验证会话的适配器，返回 `VerifiedSession` 后才会生成绑定的 `providerId`；请求体、角色切换和客户端自带 `providerId` 均不参与认证。

- 没有已验证会话：401 `UNAUTHENTICATED`。
- 已登录但不是服务方，或会话未绑定服务方：403 `FORBIDDEN`。
- 默认 reader 仅在 `DEMO_AUTH_ENABLED=true` 且有效演示 cookie 对应当前账号绑定时返回固定服务方身份；客户端传入 userId/providerId/角色不能产生会话。过期、撤销、账号删除或绑定不符均视为会话失效，返回 401。真实认证仍未接入。
- 报价 API 与报价引擎可复用 `findDemand`；页面和客户端仍禁止直接导入数据库服务。

### 演示服务方登录

入口位于顶栏右上角登录状态按钮的浮层中，始终显示“模拟身份 · 演示专用”；角色导航不等于登录。维护者本地设置 `DEMO_AUTH_ENABLED=true`、运行 `npm run db:setup` 并重启应用后，才可点击“演示服务方登录”。默认关闭，不改已有 `.env`。

登录请求仅为 `{ "action": "login_demo" }`，拒绝任何身份字段。`DemoProviderSession` 是三种状态的联合：`{status:"disabled",demo:true}`、`{status:"signed_out",demo:true}`，以及 `{status:"signed_in",demo:true,identity:{userId:"demo-provider-account",role:"provider",providerId:"provider-a"},expiresAt:"ISO 8601"}`。所有成功响应带 `meta.source: "mock"`，响应不缓存，不包含 cookie 令牌。

Cookie `ai_home_demo_session` 使用 256 位随机凭证；数据库只存摘要、账号和绑定快照，30 分钟绝对过期。HttpOnly、SameSite=Strict、Path=/，HTTPS 时 Secure。POST/DELETE 强制同源 Origin；缺失或跨站为 `403 FORBIDDEN`。POST 未开启为 `403 DEMO_AUTH_DISABLED`，坏 JSON/字段为 400，账号未准备为 `503 DEMO_ACCOUNT_UNAVAILABLE`，数据库错误为 `503 SESSION_UNAVAILABLE`。退出会撤销数据库记录后清除 cookie；关闭演示期间 reader 拒绝所有演示 cookie，同源退出仍可撤销已有会话。

B 已从 `@/lib/server-auth` 导入 `readDemoVerifiedSession`，作为处理器默认的 `readSession` 和 `readTransactionSession`；后者使用内核传入的当前 `tx`。每次验证过期、撤销、账户角色及固定绑定，不复用预检快照。有效演示 cookie 的合法首次提交返回 201/mock，同键重放返回 200/mock；关闭演示、过期、退出或绑定失效仍返回 401。演示登录不是生产认证，也不授予业主报价比较读取权限；业主须使用独立的实际业主会话读取本人需求报价，当前此链路已接通。

## GET /api/match 查询参数

- `demandId` 是可选的单值查询参数。省略时保留 `demo-demand` 的演示入口，返回 `Match[]`，`meta.source` 为 `mock`。
- 显式 ID（包括 `demo-demand`）读取数据库；不存在返回 `404 DEMAND_NOT_FOUND`，不会回退到默认需求。
- 参数为空、纯空白、重复或含未知参数返回 `400 VALIDATION_ERROR`。错误响应仍使用统一失败信封。
- 当前先执行受控需求读取，再加载公开目录计算匹配；拒绝时不会读取目录或排序。目录含固定 mock 资料，所以整体仍为 mock。

B #161 已将原始 Request 传给 `loadMatchData(request)` 并调用 D 的 `readMatchingDemand(request)`：复用公共 `DemandIdParams`/`Demand`，published 可公开读取，其他状态仅所属业主；显式业主凭证必须有效，不回退匿名。会话、当前角色、按范围过滤的查询及输出验证在同一 Serializable 事务中完成。无参数固定 mock；显式 demo 也必须存在且满足发布/归属规则。非公开他人需求与不存在统一 404，凭证失效 401、角色变化 403、坏数据/存储失败 503；成功与失败均为 private, no-store，Vary 包含 Cookie。仅服务方即使有实际接单关系，也不能匹配非公开需求。目录错误仍为 503/PROVIDER_UNAVAILABLE，不回退成功。详细导入及错误映射见 `docs/requests/D-match-read-access.md` 和 `docs/requests/B-match-read-access.md`；共享生产冒烟覆盖正常接受报价后的实际非公开需求。

## ID 与状态
固定演示需求 demo-demand，服务方 provider-a 到 provider-f。
Demand.status：draft → published → contracted → in_progress → completed；状态流转规则由 D 的业务层实现。
Quote.status：draft/submitted/accepted/rejected；提交报价不等于用户接受。
Schedule 通过 version 表示版本；重新排期应保留旧计划，展示差异并让负责人确认。
Payment 仅 pending/confirmed_demo；不是支付接口。当前 `POST /api/payment` 无身份校验，只做进程内演示状态转换，进程重启后恢复初始状态，不代表真实付款、资金托管或数据库持久化。
Ticket 包含 demandId、responsibleProviderId（可空）、category、status。

## 逐条来源

`Demand.source` 是输出中的可选字段，值为 `mock` 或 `live`；字段缺失表示来源未知。需求服务会为演示需求填入 `mock`，为数据库需求填入 `live`。`DemandInput` 和更新输入不接受该字段，客户端不能声明来源。整体响应的 `meta.source` 继续按整批数据标记，混入 `demo-demand` 时仍为 `mock`。

`Quote.source` 已增加为输出中的可选字段，沿用公共 Source；缺省兼容旧 DTO，不能解释为 live。数据库 `Quote.source` 非空且默认 mock，普通 schema 同步会把无来源的历史记录回填 mock，固定 mock 报价也显式输出 source。`QuoteSubmissionInput` 仍拒绝 source/meta，客户端不能指定来源。B 服务端已从 `@/lib/quote-policy` 导入 `parseStoredQuoteSource` 严格校验库值，再用 `summarizeQuoteSources(demand.source, returnedQuotes)` 汇总：全 live 才 live，混合/缺省 mock，空列表沿用需求来源。非法持久化值会报错，不能降级为 mock。首次/重放/GET 的来源映射均已接入，详见 `docs/requests/D-quote-source.md` 的调用与旧库同步步骤。

## AI 接入

AI 澄清默认是 mock，已有服务端 live 网关，仓库不包含供应商凭据。本轮浏览器演示明确使用 mock；真实需求澄清完整业务验收仍待完成，本机配置、单次连通或受控响应测试不能代替完整草稿、缺失字段、非法 JSON、失败与来源验证。

默认 `AI_MODE=mock`，会返回固定追问并标记 `meta.source: "mock"`。设为 `live` 后，服务端读取 `LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL`，调用 OpenAI 兼容的 `/chat/completions` JSON 接口；响应必须通过 `ChatResult` 校验后才标记 `meta.source: "live"`。
网关默认超时 5 秒、最多 2 次重试，可由服务端 `LLM_TIMEOUT_MS` 和 `LLM_MAX_RETRIES` 调整。缺少配置、超时、重试耗尽、非 JSON 或不符合契约的模型输出均返回 503 `AI_UNAVAILABLE`，不会伪装成成功或 mock。
模型可生成文字解释和候选方案；费用合计、排期依赖和状态合法性由代码复核。
照片只能辅助提示疑点，不能替代现场检测或证明施工合格。
没有经过出题方确认的 API、性能或产品能力不能写成已接通/已验证。

## 需求 CRUD 契约

对应请求：docs/requests/D-demand-contracts.md。需求创建、详情、更新和删除路由均已实现。

| 方法 | 输入 | 成功返回 | 当前实现 |
|---|---|---|---|
| POST /api/demand | DemandInput | 201 envelope(Demand)，初始 published | 已接同源与实际业主会话；事务内以当前业主为 ownerId |
| GET /api/demand/[id] | DemandIdParams | 200 envelope(Demand) | 事务内限定范围；published 公开，非公开仅所属业主可读 |
| PUT /api/demand/[id] | DemandIdParams + DemandUpdateInput | 200 envelope(Demand) | 已接业主会话、同源检查及事务内归属/状态校验，可使用密码登录凭证 |
| DELETE /api/demand/[id] | DemandIdParams | 200 envelope(DemandDeleteResult) | 已接业主会话、同源检查及事务内归属/状态/关联校验与删除 |

PUT 完整替换可编辑字段，全部必填，不提供 PATCH。创建/更新禁止客户端设置 id、ownerId、status、source 或未知字段；description/city 去除首尾空白后不可为空，面积为有限正数，预算为非负安全整数分且下限不超过上限。更新/删除只允许 draft 或 published；进入 contracted、in_progress 或 completed 后返回 409/INVALID_STATE。PUT/DELETE 先验证归属，再检查状态和只读规则：本人 `demo-demand` 返回 409/DEMO_DEMAND_READ_ONLY，他人的演示需求仍为 404。DELETE 检查所有报价（含 draft/rejected）、排期、付款、评价和工单关联，存在关联时返回 409/DEMAND_HAS_RELATED_RECORDS，不级联清除。删除结果为 {id,deleted:true}，仍须包含来源信封。

PUT 的非空 ID 原样精确查找，不去除首尾空白。处理顺序为路径 400 → 同源 Origin 403 → 业主会话预检 401/403/503 → JSON/公共输入校验 400 → 写事务内重新鉴权、按 id + 当前 userId 查询、校验状态并更新。缺少/伪造/重复/过期/撤销的业主凭证返回 401；仅有服务方演示 cookie 也为 401；有效业主凭证对应账户已不再是 owner 为 403。预检失败不消费请求体或读取需求，读取请求体时不持有事务。两次身份不一致为 403。他人和不存在的需求统一返回相同的 404/DEMAND_NOT_FOUND；最后一次更新 SQL 同时过滤 ID、ownerId 和可编辑状态。

PUT 所有响应均带 `Cache-Control: private, no-store`、`Vary: Cookie`。输出 DTO 在事务内验证，拒绝、非法输出及写入异常回滚；存储/事务异常返回 503/DATABASE_UNAVAILABLE，不回退 mock。异常响应只说明暂时无法确认更新结果，调用方应刷新核实，不能推断此前一定未保存。成功返回数据库需求及 `meta.source: live`。完整协议及验证见 `docs/requests/D-demand-update-auth.md`。

POST 先校验同源 Origin 和实际业主会话，在事务外读取/校验 DemandInput，再在写事务内重验会话和当前账号角色；两次身份不同为 403。ownerId 仅取最终验证的当前 userId，初始 published，禁止客户端身份/状态/来源字段。成功 201/live，公共输出在事务内验证；无会话 401、非业主/跨源 403、输入 400，存储或未知提交结果 503 提示刷新核实。所有响应 private, no-store、Vary: Cookie。已移除固定 demo-owner 创建入口，历史需求归属不自动转移。验收通过实际登录 → 创建 → 修改 → 演示服务方报价 → 本人读取，另一业主无法修改或读取该报价。详见 `docs/requests/D-demand-create-auth.md`。

DELETE 无请求体，非空 ID 原样精确查找，错误顺序为路径 400 → 方法/同源 Origin 403 → 事务内业主会话 401/403/503 → 本人需求 404 → 只读/状态/关联约束 409 → 删除。凭证规则与 PUT 一致；他人和不存在统一 404。会话、当前账号、归属、状态、五类关联检查、删除及输出校验全部处于同一个 Serializable 事务；最后 DELETE SQL 也限制 ID、ownerId、可编辑状态和关联均为空，必须恰好删除一条。成功为 200/live，重复删除为 404；所有响应 private, no-store、Vary: Cookie。事务/存储故障为中性 503/DATABASE_UNAVAILABLE，提示刷新核实，不承诺之前一定未删除。详见 `docs/requests/D-demand-delete-auth.md`。

需求 POST 当前业主归属沿用 #95，列表/详情的访问范围见下节。历史 demo-owner 需求不自动转移；显式排期查询的独立归属校验见 GET /api/schedule，匹配读取权限见 GET /api/match。已验证的接口不代表整个模块或平台已经完成权限隔离。

## GET /api/demand 与 GET /api/demand/[id]：访问隔离

不接受任何查询参数（包括 ownerId、providerId、role、status、分页和重复参数）；非法参数/空白 ID 返回 400/VALIDATION_ERROR。非空路径 ID 原样精确查找，不 trim。继续返回公共 Demand[] / Demand。

在同一个 Serializable 事务中验证持久化会话、当前角色/绑定、执行受限 SQL 并校验输出。列表：有效业主 cookie 只返回本人全部状态；没有业主 cookie 时按 published 过滤，匿名无需服务方登录即可访问，包含已发布的 demo-demand。详情：published 对所有访问者可读，非 published 限所属业主，或无业主 cookie 且当前有效服务方拥有实际 ServiceOrder 关系；后者须核验需求、接单状态、acceptedQuote、providerId 和来源一致，不能凭一份报价取得访问权。其他人与不存在统一 404/DEMAND_NOT_FOUND。响应仍使用公共 Demand，不包含 ownerId 等业主信息；管理员尚无全量入口。

存在但伪造、重复、过期或撤销的业主凭证为 401/UNAUTHENTICATED；有效业主凭证对应当前角色不再是 owner 为 403/FORBIDDEN。这两条也适用于已发布详情。双 cookie 时业主优先，无效业主不能回退匿名或服务方。没有业主 cookie 时，演示服务方关闭/过期/撤销/绑定变化不妨碍访问 published 数据，但会失去非公开接单详情权限。角色导航及自报身份不能扩大权限，合法空结果才返回 200 空数组。

逐条 source 将精确固定 ID demo-demand、demo-completed-a/b/c/d 标为 mock，其他数据库需求为 live；不按前缀猜测。普通匿名和业主整体含这些模拟需求时为 mock，否则 live（含空列表）；有效演示服务方会话整体仍为 mock，包括已接单需求详情。合成 completed 需求不会进入匿名列表，原有归属及接单权限保持。所有响应 Cache-Control: private, no-store、Vary: Cookie；存储、坏 DTO、异常接单关联或越界查询结果统一 503/DATABASE_UNAVAILABLE，不回退 mock 或空成功。A/B/C 使用原 URL/DTO，C 大厅、管理页与匹配页可继续匿名获取 published 数据。完整交接与验证见 docs/requests/D-demand-read-auth.md 及 docs/requests/D-provider-demand-access.md。状态推进由 `/api/order/progress` 在同一事务条件更新需求和接单，避免两侧状态不一致。
