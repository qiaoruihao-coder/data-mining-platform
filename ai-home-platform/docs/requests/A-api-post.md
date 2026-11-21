# A 的变更请求：新增浏览器端 POST 封装

- 提出角色：A
- 目标文件（D 所有）：`src/lib/api-client.ts`
- 状态：待 D 评估

## 需要什么

A 的需求澄清页需要提交结构化需求（`POST /api/demand`）。当前 `src/lib/api-client.ts` 只有 `apiGet`。

建议新增：

```ts
export async function apiPost<T extends z.ZodTypeAny>(
  path: string,
  body: unknown,
  schema: T,
): Promise<{ data: z.infer<T>; source: "mock" | "live" }>
```

行为约定（与 `apiGet` 保持一致的严格度）：

1. 设置 `content-type: application/json`，`body` 用 `JSON.stringify`。
2. 非 2xx 时先尝试解析失败信封 `{ ok:false, error:{ code, message } }`，抛出带 `code` 与 `status` 的错误；**不要**抛出不带 code 的通用错误，调用方需要区分 400 / 501 / 503。
3. 2xx 时用 `envelope(schema)` 校验，返回 `data` 与 `meta.source`。
4. 不处理 501 的业务含义（那是调用方的事），但必须让调用方拿得到 `status === 501`。

## 为什么不是 A 自己加

`api-client.ts` 属于公共层（见 docs/OWNERSHIP.md、scripts/ownership.mjs），A 不得自行改写。

## 过渡方案（已实现，不需要等）

A 在 `src/features/a/` 内直接使用 `fetch`，并用 `src/contracts` 的 `envelope`/`Demand` 校验响应，
区分 400/501/503；`docs/API.md` 的契约没有被改动。D 实现 `apiPost` 后，A 再做一次等价替换即可，
页面逻辑与测试不需要变。

## 影响范围

- 只影响调用方写法，不涉及契约字段、mock 数据或数据库。
- 若 D 同意，建议同时给 `apiGet` 补 `status` 信息，便于区分“404 资源不存在”和“网络失败”。
