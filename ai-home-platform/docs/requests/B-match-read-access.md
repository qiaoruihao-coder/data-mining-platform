# B：匹配 API 受控需求读取接线

2026-11-15，基于 main `d06ef42` 与 D #160，按 `D-match-read-access.md` 接入权限基础设施。本次只修改 B 的匹配路由、数据加载器、B 测试和此交接，不改公共契约、依赖、配置、数据库 schema 或排序权重。

## 行为

- 路由将原始 `Request` 传入 `loadMatchData(request)`，加载器先调用 D 的 `readMatchingDemand(request)`。移除直接 `findDemand(id)` 读取及本地演示回退，查询参数、Cookie、会话、需求发布状态和归属统一由 D 在事务内校验。
- 读取失败立即结束，不调用目录或排序。`MatchingDemandAccessError` 交 `matchingDemandFailureResponse`；目录异常仍返回 503/PROVIDER_UNAVAILABLE，其他异常中性 503/DATABASE_UNAVAILABLE。成功、参数拒绝、身份拒绝、不可访问及服务异常统一使用 `MATCHING_DEMAND_RESPONSE_HEADERS`：`Cache-Control: private, no-store`、`Vary: Cookie`。
- 匿名及仅服务方身份只读 published；本人业主可读本人全部状态，他人非公开与不存在同为 404。无效、重复、过期、撤销业主 Cookie 为 401，角色变化为 403；不能回退匿名或服务方。未知/重复/空查询参数为 400。
- 无参数仍由 D 返回固定 mock 需求；显式 demo-demand 必须存在并通过访问检查。仅需求与目录信封均 live 才标整体 live；当前固定服务方目录仍 mock。评价、档期规则以及页面的独立读取方式均不变。

## 验证方式

`tests/B-match-read-access.test.ts` 用独立临时 SQLite、合成账号/需求和 D 签发的真实持久化会话，缺省直接调用生产路由函数。构建后可在 PowerShell 执行：

```powershell
$env:B_MATCH_HTTP = '1'
npx.cmd tsx --test tests/B-match-read-access.test.ts
Remove-Item Env:B_MATCH_HTTP
```

HTTP 模式自动分配本地端口，以同一个隔离数据库启动生产服务并运行相同权限矩阵，结束后停止子进程、断开数据库并清理本次临时目录；不覆盖已有 `.env` 或用户数据库。覆盖 GET、匿名 HEAD、发布状态撤销、显式演示缺失、坏数据 503 与响应头。另有 API 单元测试确认拒绝发生在目录查询之前、目录 503 无旧结果且保留缓存头。

## 剩余与 D 交接

请 D 在本 PR 合入后更新 README 与 docs/API.md 中“匹配读取仍未接线”的描述，并按原计划扩充共享生产 smoke；B 不越界修改这些文件。本次不等于平台整体权限审计完成，也不实现真实服务方认证、真实 AI 或新的演示排序数据。没有新增运行时 mock；测试合成需求/账号不代表真实业务记录。

## 实际结果

- `npm.cmd run check`：994/994，lint、typecheck、模块边界全部通过；`npm.cmd run build` 通过。
- 首次生产权限测试被过严的 Vary 整串断言拦下：Next.js 会自动追加 RSC/路由字段。已改为按独立 token 检查 Cookie，仍精确要求 `private, no-store`；随后路由专项 13/13、生产 HTTP 权限矩阵 7/7 全部通过。没有修改运行时代码来绕过检查。
- HTTP 实际验证匿名草稿/他人非公开/服务方非公开 404，本人全部状态 200，失效/重复/过期/撤销业主 cookie 401，当前角色变更 403，非法查询 400，坏需求 503；无参数演示也不能绕过失效业主凭证。HEAD 同样保留权限与缓存头。
- 另用专用隔离 SQLite 执行 `node scripts/run-production-smoke.mjs`：13 页面、32 GET、13 POST 基础场景及照片、履约、评价、来源隔离、履约历史扩展链路通过。新权限矩阵单独走真实生产 HTTP，未将原有 smoke 冒充新权限验证。
- `npm.cmd run scope -- --role B --base origin/main`：7 个文件均归 B；`git diff --check` 通过。生产服务均已停止，新测试创建的隔离库已清理；没有改变本机用户数据库。
- 运行时仍使用固定 mock 服务方目录，未新增模拟业务数据或调用真实 AI。共享 README/API 状态更新及最终集成由 D 处理；本次权限修复不依赖待调整的演示排序数据。
