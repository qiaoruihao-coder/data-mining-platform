# D：共享 PUT/DELETE 客户端封装

- 角色：D
- 状态：已提供，等待 A 切换调用方。
- 原因：共享客户端原先只有 `apiGet` 和 `apiPost`；需求编辑页需要提交 PUT 和 DELETE，不能继续各自维护 fetch 错误解析。

## 调用方式

```ts
import { apiDelete, apiPut } from "@/lib/api-client";
import { Demand, DemandDeleteResult } from "@/contracts";

await apiPut(`/api/demand/${encodeURIComponent(id)}`, input, Demand);
await apiDelete(`/api/demand/${encodeURIComponent(id)}`, DemandDeleteResult);
```

两个函数都会校验公共成功信封，失败时抛出带真实 `status` 和 `code` 的 `ApiClientError`。`apiPut` 会发送 JSON 请求体并保留调用方请求头；`apiDelete` 默认不发送请求体。`501`、`401`、`403` 等失败状态不会被转成成功数据。

## A 的迁移边界

A 可以在需求编辑调用方中把本地 fetch 封装替换为上述函数；本次 D 不修改 `src/features/a/`。需求更新和删除接口当前仍缺少服务端身份校验与 `ownerId` 数据隔离，页面迁移客户端封装不会改变这一已知安全缺口，详见 `docs/API.md`。
