# D：业主会话读取与报价读取授权

后续更新（2026-11-14）：本文保留原交付范围；业主密码登录/注销现由 `docs/requests/D-owner-login.md` 补齐，需求 PUT 鉴权已随 #84 合入。下文“未提供登录”描述原阶段限制，不代表当前登录实现状态。DELETE、POST 归属和查询隔离仍待办。

日期：2026-11-14 · 同步基线：main 05da047 · 对应请求：B-quote-read-protocol.md、D-quote-read-protocol.md

## 本次变更申请

B 的读取内核需要可直接传入的会话验证与需求归属授权。本次由 D 增加 OwnerSession 表（随机令牌 SHA-256 摘要、userId、创建/到期/撤销时间），以及公共 OwnerIdentity、QuoteQuery/DTO。报价和金额 DTO 不变，无新依赖。

服务端入口从 server-auth 导出 readOwnerVerifiedSession、authorizeOwnerQuoteRead、parseQuoteQuery 与明确的拒绝错误。凭证和当前账户在传入的同一事务读取；归属通过 id + ownerId 查询，其他业主与不存在统一 404。有效服务方或管理员身份拒绝 403；未知/过期/撤销凭证 401；数据库故障 503，不回退 mock。错误响应禁用缓存。

本轮交付服务端会话存储、读取、撤销和授权。签发函数仅供 D 的可信认证代码在身份验证成功后调用，不暴露 HTTP 签发路由、不创建固定业主登录。业主密码/外部认证入口未实现；B 接入后没有有效签发凭证的请求仍应拒绝。测试身份与数据只放在隔离临时 SQLite。

不修改 B 的 GET/报价内核，也不在本轮修改需求 PUT/DELETE；其鉴权缺口列入 D 待办。

## 验收标准

- 参数使用 contracts 且精确匹配，不因重复参数、空白或未知键改变查询范围。
- 无凭证、伪造、过期及撤销拒绝；数据库仅存摘要，重连可验证持久化会话。
- 当前角色与需求归属在 B 当前事务复核；服务方/管理员无权，其他业主/不存在均为同一 404。
- 所有需求状态下，本人可读取 submitted/accepted；数据读取失败不伪装成功。
- 已授权后在当前事务撤销、换角色或换归属，下一次授权立即拒绝；拒绝早于报价查询。
- check、build、D scope 通过，只提交 D 文件。

## 已实现的 B 接入方式

仅从 `@/lib/server-auth` 导入以下入口；不要导入内部 owner-auth 签发模块。

- `parseQuoteQuery(new URL(request.url).searchParams)`：返回公共 QuoteQueryDTO；仅无参数时为 null，非法参数抛 OwnerAccessError/400。
- `readOwnerVerifiedSession(request, tx)`：有效凭证返回公共 OwnerIdentityDTO；无效/过期/撤销返回 null，当前账户角色不符抛 403，存储异常抛 503。参数 tx 必填。
- `authorizeOwnerQuoteRead(request, demandId, tx)`：直接作为 B 的读取内核回调；仅 GET/HEAD 可用。允许时返回 true，拒绝抛 OwnerAccessError（400/401/403/404/503）。账户删除会级联删除会话，因此通常按失效凭证返回 401。
- `ownerAccessFailureResponse(error)`：将已分类 OwnerAccessError 转为统一失败信封及禁止缓存头；B 的其他读取/JSON/契约异常应先映射为 DATABASE_UNAVAILABLE。B 自有 QuoteReadDenied 映射为 FORBIDDEN。
- `QUOTE_READ_RESPONSE_HEADERS`：显式查询的成功和失败响应均使用 `Cache-Control: private, no-store`、`Vary: Cookie`，路由动态执行。

```ts
// 以下为 B 后续接线示例，不是已上线的路由。
const query = parseQuoteQuery(new URL(request.url).searchParams);
// query === null 时使用现有无参数 mock 分支。
if (query) {
  const result = await readStoredQuoteComparison(request, query.demandId, authorizeOwnerQuoteRead);
  if (!result) throw new OwnerAccessError("DEMAND_NOT_FOUND");
  return Response.json(result.response, { headers: QUOTE_READ_RESPONSE_HEADERS });
}
```

所有授权查询使用传入的 tx，没有全局 Prisma 回退。需求查询按 `id + ownerId` 过滤，再验证返回行的范围；他人和不存在需求错误码/文案完全相同。有效业主 cookie 优先；缺少业主 cookie 但持有有效演示服务方 cookie 时拒绝 403，存在无效/重复业主 cookie 时不会回退其他身份。事务内撤销、换角色、换归属对后续授权立即生效。

## 会话签发与当前限制

D 内部的 `issueOwnerSession(verifiedIdentity, tx)` 只供已完成密码或外部认证的可信服务端调用。它再次检查当前 owner 账户，生成随机 256 位令牌，表中仅保存 SHA-256 摘要，绝对有效期 30 分钟。返回 cookie 字符串只能放入 HTTPS `Set-Cookie`：`__Host-ai_home_owner_session`、HttpOnly、Secure、SameSite=Strict、Path=/；不得写入 JSON、URL、日志或浏览器存储。`revokeOwnerSession(request, tx)` 更新撤销时间；后续注销路由必须先完成同源/CSRF 校验，再撤销并清除 cookie。

没有公共签发接口，没有固定业主登录，没有种子业主会话。浏览器登录入口及密码/外部身份验证仍是明确待办，当前功能不能被描述为生产登录已完成。测试签发输入是合成身份，但读取器与授权器使用实际数据库记录和随机 cookie；B 的读取内核调用的也是本次真实实现。演示需求结果为 mock；隔离测试中的非演示需求按既有规则为 live，不能据此宣称已接通真实用户数据。

本地/CI 同步 schema 沿用 `npm run db:setup`；本轮只重新生成 Prisma Client，数据库测试只对临时文件执行建表，未改现有 `.env` 或开发数据库。没有新增配置或依赖。

## 待办交接

需求 PUT/DELETE 的身份和所有者校验已列入 `docs/tasks/D.md` 高优先级待办，连同 POST 固定业主和查询隔离问题。当前授权器只用于报价读取，允许本人所有需求状态的历史读取，不能拿它直接替代修改/删除权限。
