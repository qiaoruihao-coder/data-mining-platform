# A：业主端读取当前订单以接线履约推进

## 状态

PR132 已合入 `main`，D 已提供 `GET /api/order?demandId=<id>`。A 已完成订单读取、履约推进按钮和排期刷新接线；本任务分支中的实现可直接基于该公共接口评审。

## 背景

`POST /api/order/progress` 已提供，但 A 的施工进度页目前只拿到 `demandId` 和 `Schedule`。公共 `Demand` 不含 `orderId`，也没有业主可读的订单摘要；不能把需求编号当订单编号，也不能让业主页面调用只面向服务方的 `GET /api/provider/orders`。

## 请求 D 提供的最小读取接口

`GET /api/order?demandId=<id>` 仅允许当前业主读取本人需求的实际接单关系，返回统一成功信封：

```ts
{
  order: OrderSummary | null,
  schedule: Schedule | null
}
```

其中 `OrderSummary` 和 `Schedule` 直接复用 `src/contracts` 现有类型；无接单关系返回 `order: null`，不回退固定演示订单。需要与需求详情相同的 owner 会话、同源、`private, no-store` 和 401/403/404/503 规则；匿名、服务方会话和他人需求不能读取。

## 接线影响

A 收到 `order.id` 后调用现有 `POST /api/order/progress`，每次把最新 `schedule.version` 或 `null` 传入；成功后同时刷新需求详情和排期。409、503、501 或网络不确定时仅提示刷新核实，不自动重发。接口来源沿用接单来源，mock 必须在页面显示。
