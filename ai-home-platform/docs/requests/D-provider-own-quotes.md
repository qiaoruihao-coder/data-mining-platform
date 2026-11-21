# D → C：按当前服务方会话查询本人报价

日期：2026-11-14，已同步 main `b7b08e4`。回应 `C-provider-orders.md` 中允许先提供“本人报价”的最小查询请求。现有库无独立接单关系，本次不把 submitted/accepted 报价推导为真实接单或履约状态。

## 冻结的接口

- `GET /api/provider/quotes`，无参数；任何查询参数（含 providerId、userId、status、分页或重复参数）均为 400 `VALIDATION_ERROR`。不由浏览器下载全量后过滤。
- 成功 `200 envelope(Quote[])`，复用 `src/contracts` 的 Quote。返回当前服务方的全部持久化报价状态（draft/submitted/accepted/rejected），按 id 升序；ID 顺序不代表提交时间、推荐或成交排序。只返回报价公共字段，不暴露其他业主资料或内部幂等键。
- 在同一 Serializable 事务内读取实际服务方会话、当前账号角色和绑定，再执行 `where: { providerId: 当前会话绑定 }`；结果逐条再次核验归属并用公共 Quote 校验，不能注入客户端身份或认证快照。
- 当前实际可用的服务方登录仅为 `DEMO_AUTH_ENABLED=true` 下的固定演示会话。有效演示凭证可查 provider-a；匿名、伪造、重复、过期、撤销、演示关闭或当前绑定失效为 401，只有业主凭证为 403；当前业主 cookie 不转换为服务方。若同时有两个有效角色 cookie，本接口使用有效服务方 cookie，符合现有两个登录会话相互独立的规则。
- 数据库异常、来源/JSON/DTO 损坏或查询返回其他服务方记录为 503 `DATABASE_UNAVAILABLE`，不回退固定 mock 或成功空数组。只有鉴权通过且库中确实无本人记录才返回 200 空数组。
- 每条 Quote.source 严格保留持久化的 mock/live，非法或缺失库值失败；当前演示身份决定整个响应 `meta.source: mock`，即使记录落库或单条 source=live 也不把演示会话变成生产身份。空列表也标 mock。所有成功/失败均 `Cache-Control: private, no-store`、`Vary: Cookie`。

## C 的接入与边界

C 可将现有 `apiGet('/api/quote', Quote.array())` 改为 `apiGet('/api/provider/quotes', Quote.array())`，在页面明确称“本人报价”，分别显示提交、接受、拒绝等报价状态；不能把 submitted 当接单，不能把 accepted 当独立履约证明。401/403/503 不得显示成没有接单，刷新失败应清除旧记录或明确过期状态。逐条与整体来源继续分别展示。

本 PR 只交付 D 的 API、基础设施和测试，不修改 C 的页面或 B 的报价模块。真正的 `GET /api/provider/orders`、接单关系/创建时机、接受报价原子流程和生产服务方登录仍待设计与对应负责人接线，不伪装为已经交付。

## 验收计划

隔离 SQLite 中放入两个服务方的各状态报价，实际演示 cookie 只返回当前绑定数据；伪造参数/请求头不能扩大范围；角色/绑定/会话变化必须重验；未知来源、非法 JSON 和数据库错误不返回空成功；实际公开路由覆盖登录、读取、退出再读拒绝。仅使用合成账号/报价，保留演示来源。

## 已执行结果

定向 8 项测试通过；同步最新 main 后 `npm run check` 547/547、`npm run build` 通过，合并提交后重新检查 D scope（6 个文件）。实际公开路由演示登录、查询和退出后 401 通过；当前仅提供一个固定演示服务方登录，两个服务方隔离验证使用同库的 A/B 数据，未宣称已支持两个生产服务方账号登录。C 页面尚待接线，未把报价页面当作真实接单验收。

同步保留已合入的 #91 删除鉴权；旧 createDemand 的移除及当前业主创建在 #95 完成，本 PR 不重复带入另一功能。已推送分支通过合入 main 的普通提交同步，不强推。
