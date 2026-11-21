# D：允许 B 的匹配查询复用需求服务

- 角色：D；状态：已提交，等待 B 在自己的 PR 中接入。
- 背景：B 的 `/api/match` 当前只能读取固定 `demo-demand`。B 需要在服务端查询真实需求，才能让 `demandId` 与 A 的需求详情保持一致。
- 共享边界变更：边界检查只为 `src/lib/match/**` 和 `src/app/api/match/**` 放行对 `src/lib/demand.ts` 的只读导入；其他跨角色业务导入仍拒绝。
- D 提供：`findDemand(id)` 返回公共 `DemandDTO` 与 `source`，未知 ID 返回 `null`，不回退到演示需求。
- B 负责：在 `src/lib/match/data.ts` 或匹配路由中调用 `findDemand`，保留无参数演示入口，真实需求按 ID 查询并沿用统一来源信封；页面、匹配规则和 B 自有测试由 B 修改。
- 验收：`npm run boundaries` 通过；B 的 `/api/match?demandId=<真实 ID>` 不再因静态边界规则阻塞，未知 ID 仍返回 404。
