# D：报价服务端查询与身份基础设施

- 角色：D
- 状态：基础设施已提供；报价权限、状态校验、幂等和写入仍由 B 实现。
- 关联请求：`docs/requests/B-quote-submission.md`、`docs/requests/B-demand-query.md`

## 已交付

1. `src/lib/demand.ts` 仍是需求数据库查询的唯一服务入口；边界检查允许 `src/app/api/quote/` 和 `src/lib/quote-engine/` 复用 `findDemand`。
2. 页面、组件和其他客户端代码仍不能导入 `src/lib/demand.ts` 或 Prisma。报价模块只能在服务端路由/基础设施中调用它。
3. `src/lib/server-auth.ts` 提供 `requireProviderIdentity(request, readSession)`。`readSession` 必须来自已验证的服务端会话适配器，返回 `VerifiedSession` 后才会得到会话绑定的 `providerId`。
4. 默认认证适配器明确返回 401；业主、运营或没有服务方绑定的会话返回 403。默认不会产生 demo provider，也不会读取角色切换或请求体中的 `providerId`。

## B 的接入边界

- B 可在报价 API 或报价引擎中调用 `findDemand` 读取同一需求，并据此实现需求状态、报价权限、幂等和写入。
- B 应先调用 `requireProviderIdentity(request)`，失败时原样返回 401/403；客户端传入的 `providerId` 必须由输入契约拒绝。
- 本次没有引入登录产品、cookie 格式或第三方认证依赖。真实会话适配器接入前，报价提交仍必须保持 501 失败语义，不能用 mock 身份返回成功。
