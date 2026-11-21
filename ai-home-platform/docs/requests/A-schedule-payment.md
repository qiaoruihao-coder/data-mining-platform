# A 变更请求：施工进度与付款页的字段缺口

发起人：A（业主端） · 日期：2026-11-13 · 关联页面：`/owner/project/[id]`、`/owner/payments/[id]`

两页前端已按现有 mock 接口（GET /api/schedule、GET /api/payment）接通并上线交互，
但以下信息是页面语义必需、契约里却没有的字段。请 D 评估后更新契约与 mock（过渡期全部用可选字段）。

## 一、Schedule 契约缺口

| 需求 | 建议字段 | 类型 | 用途 |
| --- | --- | --- | --- |
| 真实日期轴 | `plannedStartDate` | `string`（ISO 日期，可选） | 现在只能显示「第 N 天」，业主不知道对应几月几号 |
| 实际开工/完工 | `actualStartDay` / `actualEndDay` | `number`（可选） | 区分「计划 vs 实际」，算延期 |
| 责任方姓名 | `responsibleProviderName` | `string`（可选） | 现在只能显示 `provider-a` 这种内部 ID，业主看不懂 |
| 验收状态 | `acceptance: { status, confirmedAt }` | 可选对象 | 页面「确认阶段验收」按钮需要写回目标 |

## 二、Payment 契约缺口

| 需求 | 建议字段 | 类型 | 用途 |
| --- | --- | --- | --- |
| 付款比例 | `percentOfContract` | `number`（可选） | 现在只能按金额反算占比，合同总价未知时无法显示「首付 30%」 |
| 到期时间 | `dueAt` | `string`（可选） | 提醒业主「节点款该付了」，现在没有任何时间概念 |
| 凭证 | `voucherUrl` | `string`（可选） | 「上传付款凭证」按钮的落点 |
| 类型导出 | 在 `src/contracts/index.ts` 导出 `PaymentDTO`、`TicketDTO` | — | A 目前用 `ReturnType<(typeof Payment)["parse"]>` 临时推导，等 D 补上后改为 `import type` |

## 三、接口缺口（优先级排序）

1. `GET /api/schedule?demandId=…` / `GET /api/payment?demandId=…`：现在两个接口都只返回固定演示数据，
   页面检测到 `demandId` 不一致时会显示「这条排期不属于当前需求」的提示，而不是冒充。
2. `POST /api/schedule`：排期变更申请的写回目标。
3. `POST /api/payment`：节点确认与凭证上传的写回目标。页面按钮已接好诚实提示（点开说明 501 与文档位置）。

## 四、A 已完成的部分（供 review 参考）

- `src/features/a/schedule.ts`：工期/进度推算、可开工任务、排期自检（依赖缺失、依赖未完成就开工、排期重叠、多工序同时进行）。
- `src/features/a/payments.ts`：金额汇总、节点占比、付款自检（重名节点、零金额、混需求）。
- `src/components/GanttChart.tsx` 重写为纯展示甘特图（只收 props，C 的施工方端可直接复用）。
- 测试：`tests/A-schedule.test.ts`、`tests/A-payments.test.ts`。
