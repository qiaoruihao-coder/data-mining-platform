# D 变更请求：模拟付款状态机

发起人：D · 日期：2026-11-14 · 接口：`POST /api/payment`

## 本次范围

补齐最小的付款节点确认动作。输入使用公共 `PaymentActionInput` 契约：

```json
{"paymentId":"payment-demo","action":"confirm_demo"}
```

服务端只允许 `pending → confirmed_demo` 一次状态转换。未知节点返回 `404 PAYMENT_NOT_FOUND`，重复确认返回 `409 PAYMENT_ALREADY_CONFIRMED`，坏 JSON 或不符合契约返回 `400`。

## 模拟边界

本接口只修改进程内演示状态，成功信封固定标记 `meta.source: "mock"`，返回的 `simulated` 固定为 `true`。它不代表真实付款、资金托管、凭证上传或数据库持久化；这些能力仍待后续接入。
