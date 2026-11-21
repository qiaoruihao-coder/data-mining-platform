# D：排期查询的业主权限隔离

日期：2026-11-14。范围：一个独立 PR，交付 `GET /api/schedule` 的读取权限和固定演示例外；D 负责接口和基础设施，A 负责施工页。

## 原因与契约影响

原接口只按客户端传入的 demandId 查询排期，没有验证登录或需求归属，能够跨业主读取。继续使用 `src/contracts` 的 `ScheduleQuery`、`Schedule` 和统一成功/失败信封；不新增字段、依赖、环境配置或数据库表。

- 无查询参数或 demandId 精确等于已有 `DEMO_DEMAND_ID` 时返回 `mock-data` 中与 seed 共用的固定演示排期，`meta.source: mock`。演示版本只支持该固定排期的版本（当前 1），其他合法版本返回 `404 SCHEDULE_NOT_FOUND`；不读取数据库内同 ID 的可变排期。未知参数不能隐式进入演示分支。
- 显式查询接受一个非空 `demandId` 和至多一个 `version`；拒绝重复、未知、身份参数，版本必须为十进制正整数且符合公共数据库整数范围。非空 ID 原样精确匹配，不 trim。
- 真实需求在同一个 Serializable 读事务内核验实际业主 cookie、会话有效期/撤销状态、当前账户角色，再以 `id + ownerId` 查询本人需求，随后读取最新或指定版本并验证输出。不能按需求 published 状态或 source=mock 扩大公开范围。
- 演示入口无需登录，无业主 cookie 时直接返回固定数据，服务方 cookie 不影响公开访问；带业主 cookie 时仍先验证实际会话，伪造、重复、过期或撤销均为 `401 UNAUTHENTICATED`，当前账号不再是业主为 403。有效业主无需拥有 demo-demand；失效凭证不回退匿名，该规则同时适用于无参数入口和显式演示 ID。
- 真实需求缺失/伪造/重复/过期/撤销的业主凭证为 `401 UNAUTHENTICATED`；有效非业主账户或仅有有效演示服务方凭证为 `403 FORBIDDEN`。有效业主 cookie 优先；存在但失效的业主 cookie 不回退其他身份。自报身份头不参与授权。
- 有效业主查他人的非演示需求与不存在需求，均为相同的 `404 DEMAND_NOT_FOUND`；只有确认本人需求后，缺排期或缺版本才返回原 `404 SCHEDULE_NOT_FOUND`。本人需求各状态均可读取既有排期。
- 存储、事务、输出校验或返回归属/版本不匹配均为 `503 SCHEDULE_UNAVAILABLE`，不暴露内部错误，不回退 mock。所有读取响应（含演示和失败）为 `Cache-Control: private, no-store`、`Vary: Cookie`。
- 普通已授权数据库需求排期沿用 live。live 仅表示已读取持久化排期，不代表真实施工或 AI 排期能力。

## 给 A 的接入说明

URL 与返回 DTO 不变，沿用 `apiGet(..., Schedule)`。demo-demand 排期页无需登录，固定版本不存在时显示暂无该版本；真实需求排期页需先通过现有全局“业主登录”登录所属账号。401/403/DEMAND_NOT_FOUND 显示失败，不展示演示排期；失效业主登录须退出或重新登录后再浏览演示。登录后可刷新或重试。真实需求的 `SCHEDULE_NOT_FOUND` 才表示本人需求暂无该版本；保留现有 mock 来源提示。D 不修改 A 页面。

历史 `demo-owner` 不会因本功能自动获得密码或转移需求归属；无参数演示入口仍可访问。真实接单关系与服务方排期权限尚未定义，不能用“曾报过价”推导履约读取权。

## 验收与边界

隔离 SQLite 中用合成账号、真实持久化会话及公开密码登录/退出路由，验证双业主隔离、无凭证/失效/角色变化、双 cookie 优先级、精确 ID、最新/指定/缺失版本、存储异常、损坏/越界数据、来源和缓存头；请求之间改变归属或撤销会话后应立即拒绝后续读取。

交付前实际运行 `npm run check`、`npm run build`、`npm run scope -- --role D --base origin/main`，生产 `next start` 后再执行 `node scripts/smoke.mjs`。同步冒烟断言：匿名显式 demo-demand 排期 200/mock，指定有效/不存在版本分别 200/404，失效业主 cookie 即使查询演示也 401；匿名其他需求 401、未知参数 400、POST 501，失败均非成功信封。排期生成、POST 写入、依赖计算、异常变更确认和服务方履约查询不在本次范围；501 不能当作成功。

PR #104 按复审补充固定演示 ID 的公开例外；现有分支普通合并同步 main 0f1f0ea，保留历史且不强推。本次独立交付排期读取权限，不同时开展写入接口或其他角色的页面改动。

本次复审修订及同步 main 0f1f0ea 后的实际验证：现有本地库及隔离冒烟库均重新执行 `npm run db:setup` 成功；排期定向测试 15/15、`npm run check` 598/598、`npm run build`、`npm run scope -- --role D --base origin/main` 及 `git diff --check` 通过。整个 PR 共 7 个 D 文件，未包含其他任务改动。隔离 seed 数据库上的生产 `next start` + `node scripts/smoke.mjs` 通过 13 个页面、20 个 GET 场景及 5 个 POST 场景，包含匿名演示有/无版本 200/mock、缺版本 404、失效业主 cookie 401、匿名其他需求 401。没有额外浏览器手工验收；没有调用真实 AI 或连接生产数据库。冒烟使用 `AI_MODE=mock`，固定演示数据与演示服务方保留 mock，密码认证、会话及数据库查询使用实际实现。排期写入仍未实现。
