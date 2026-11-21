# D：报价提交输入契约

- 角色：D
- 状态：已冻结输入契约；`POST /api/quote` 业务实现仍由 B 负责。
- 关联请求：`docs/requests/B-quote-submission.md`、`docs/requests/C-quote-submit.md`

## 公共输入

`src/contracts/index.ts` 导出 `QuoteSubmissionInput`、`QuoteSubmissionItemInput` 及对应 DTO 类型。请求体严格只允许以下字段：

```json
{
  "demandId": "demand-1",
  "items": [
    {
      "code": "bathroom",
      "name": "浴室防滑施工",
      "unit": "m2",
      "quantity": 12.5,
      "unitPriceCents": 8000,
      "note": "含人工，现场范围待确认"
    }
  ],
  "estimatedDays": 10
}
```

- `demandId` 必填，不能为空白字符串。
- `items` 必须为 1–20 行；`code` 经 trim 后必须非空、长度不超过 100，并在同一报价内唯一。
- `name` 经 trim 后为 1–100 个字符；`note` 经 trim 后不超过 1000 个字符，可以是空字符串。
- `unit` 复用 `QuoteItem` 的 `m2`、`piece`、`job` 枚举。
- `quantity` 必须是有限正数、安全数值，最多三位小数，最大值为 1,000,000。
- `unitPriceCents` 必填，使用人民币分的非负安全整数，未知价格用 `null`；`0` 表示明确的零元，不能与 `null` 混用。
- `estimatedDays` 必须是正安全整数。

Schema 使用 strict 模式。客户端不得传入 `id`、`providerId`、`amountCents`、`knownTotalCents`、`pendingItems` 或 `status`；这些字段由服务端身份、计价和状态逻辑生成。服务端只有在鉴权、需求状态和持久化都成功后才能返回 `envelope(Quote)`，状态为 `submitted`。

## 计价与实现边界

B 负责 `/api/quote` 的业务路由、服务方身份、可报价需求校验、逐行金额和 `knownTotalCents` 计算、`pendingItems` 生成、幂等和写入。若 `unitPriceCents` 为 `null`，该行金额保持待确认，不得按零计算。已知金额必须采用与 C 预览一致的整数算法：将最多三位小数的 `quantity` 还原为千分之一整数 `quantityMilli`，计算 `quantityMilli * unitPriceCents`，再按正数四舍五入到分（等价于 `(product + 500) / 1000` 的整数除法）得到该行金额，最后累加各行结果。禁止用浮点乘法替代该规则；计算过程中必须拒绝非安全整数溢出。

C 使用同一公共输入类型提交表单，不自行声明替代 DTO。D 本次只冻结契约和共享测试，不实现 B 的报价业务 API、计价或 Prisma 写入。

当前 `POST /api/quote` 仍返回 501；501 是未实现失败，不得在页面显示为提交成功。接通真实写入后，响应来源必须反映实际链路，不能用 mock 冒充 live。
