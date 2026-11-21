# D：业主报价比较读取协议决策

日期：2026-11-14 · 基线：main 94f83a0 · 回复：`B-quote-read-protocol.md`（PR #70 已合入）

状态：权限及 HTTP 规则已冻结；D 已提供 `QuoteQuery`/DTO、持久化业主会话读取及事务授权适配器，见 `D-owner-quote-read-auth.md`。业主身份验证登录入口、公开 GET 与页面仍未接入。现有 GET 不解析查询参数，仍返回固定 mock；不能将其作为指定需求的数据库查询。

## 参数与兼容入口

- 不带任何查询参数时，保留现有固定演示数据，`200 envelope(Quote[])`、`meta.source: mock`，不返回真实数据库报价；不要求登录。
- 有查询参数时只能包含一次 `demandId`。公共 `QuoteQuery` 已在 `src/contracts` 实现，为严格对象 `{ demandId: DemandIdParams.shape.id }`；不另建报价或金额 DTO。D 的 `parseQuoteQuery` 同时检查 URLSearchParams 的键与出现次数。
- 空字符串、纯空白、重复 demandId（包括两个相同值）及任何未知参数均为 `400 VALIDATION_ERROR`。必须先检查 URLSearchParams 的键与出现次数，不能用 Object.fromEntries 悄悄覆盖重复值。
- 非空 ID 保持原值，URL 解码后精确查询；不 trim、不默认替换 demo-demand、不把查询失败回退到无参数入口。只传未知参数也为 400。

## 读取范围

| 当前服务器验证的身份 | 显式需求查询的权限 |
|---|---|
| 无会话、凭证无效、过期或撤销 | 401 UNAUTHENTICATED |
| 有效业主会话，数据库当前账户仍为 owner，需求 ownerId 等于该 userId | 允许读取本人需求的比较列表 |
| 有效业主，但需求不存在或属于其他业主 | 统一 404 DEMAND_NOT_FOUND，文案相同 |
| 服务方，包括 demo-provider-account / provider-a | 403 FORBIDDEN；即使投过该需求也不能用此接口看竞争者报价 |
| 管理员 | 403 FORBIDDEN；不默认赋予跨业主读取权限 |

当前账户不存在或已失去 owner 角色时拒绝 403；如果凭证读取器已经判定会话失效则先返回 401。只有会话角色和数据库当前角色都为 owner 才继续归属查询。角色切换、自报 userId/ownerId/providerId、持有需求 ID 或幂等键均不授予权限。服务方查询自己报价、管理员审计需另行冻结接口，本次不开放。

需求处于 draft、published、contracted、in_progress、completed 均可被其当前业主读取已有的 submitted/accepted 报价；不返回 draft/rejected 报价。读取本人历史不复用服务方写入的 published 限制，也不改变 POST 历史回执重放的限制。按报价 ID 升序稳定返回，不以 ID 表示提交时间、最新版本或排名。

## 授权与错误顺序

1. 校验显式查询参数，非法为 400；不查询需求或报价。
2. 在 B 已有 Serializable 事务中重新验证会话凭证、过期与撤销。无效为 401；认证存储或基础设施异常为 503，不伪装成匿名或成功。
3. 在相同 tx 读取当前账户并复核 owner 角色；有效凭证但账户/角色不符合为 403。不提前读取目标需求，服务方和管理员的拒绝不透露资源是否存在。
4. 按 `id + ownerId` 过滤需求归属。查无本人记录统一 404，包括 ID 不存在和其他业主的记录；文案均为“需求不存在或不可访问。”。因此不对已存在的他人需求返回不同的 403。不得先查询所有者再对外区分是否存在。
5. 只有授权器明确返回 true，B 内核才读取需求详情与 submitted/accepted 报价。必须使用传入的同一个 tx，不能复用事务外的角色或所有者快照。若内核返回 null，也映射为同一 404。
6. 存在且无可比报价返回 200 空数组；数据库、JSON、契约、金额溢出或数据范围异常为 `503 DATABASE_UNAVAILABLE`，不返回部分成功、空成功或 mock。

D 已提供兼容 B 回调的 `authorizeOwnerQuoteRead(request, demandId, tx)`：允许时返回 true，拒绝抛出携带 status/code 的 `OwnerAccessError`。会话读取 `readOwnerVerifiedSession` 强制传入 tx，检查数据库令牌摘要、到期、撤销及当前账户；不复用预检身份。B 将意外 false / `QuoteReadDenied` 映射为 403，未知异常映射为 503。真实身份验证登录入口仍未交付，不能使用固定业主、测试注入或前端选择身份替代认证。现有 `readDemoVerifiedSession` 只能产生服务方身份，不能充当业主认证。

## 返回、来源与缓存

- 成功仍使用 `200 envelope(Quote[])`；保留整数分、null、零元和额外待确认费用。D 已在公共 Quote 增加可选 source，B 复用该契约，不自行声明替代 DTO。
- 来源规则由 `D-quote-source.md` 修订：每条报价保留写入时持久化来源，只有需求和全部返回报价都为 live，整体才标 live；混合或未知来源保守标 mock。存在且无可比报价时沿用需求来源。D 已实现 schema、兼容 Quote.source、严格校验与汇总工具；B 仍需在创建/重放/GET 映射中使用持久化来源，不能直接用现有仅按需求标记的内核开放数据库 GET。授权不得因来源为 mock 而跳过，显式查询 demo-demand 仍要求其真实验证的当前业主身份。
- 显式查询的所有成功及失败响应使用 `Cache-Control: private, no-store` 和 `Vary: Cookie`，路由必须动态执行；浏览器与框架也不得共享缓存鉴权查询。
- `GET /api/provider` 仍为 mock。报价列表和服务方名称分别标识来源；名称缺失显示未知或 ID，不能因为报价为 live 就宣称服务方资料为 live。真实服务方资料接口单独交付。

## 后续交付与验收

- D：已实现公共 QuoteQuery/DTO、事务授权器、业主会话摘要验证/撤销及隔离 SQLite 集成测试；后续补齐密码/外部身份验证、登录/注销入口。会话签发只允许在上游身份验证成功后调用，不能将合成测试身份用于生产登录。
- B：D 的依赖合入后可接公开 GET 和 loadQuoteComparison，保留无参数 mock，按上述错误及缓存规则处理，使用当前事务授权器。登录入口未交付时显式查询无有效业主凭证仍拒绝，不能改用允许所有请求的适配器。
- 联调：覆盖每个角色、本人/他人/不存在、全部需求状态、空数组、重复及未知参数、会话过期/撤销、角色变化、损坏数据、查询异常，以及真实写入后的相同报价 ID/金额/null。确认他人和不存在返回同一 404，任何失败不变成 mock/空成功。

这份决策及 D 的服务端适配器不代表公开报价读取或业主登录已经接通；公开 GET 仍由 B 接线，真实身份验证入口仍由 D 后续交付。
