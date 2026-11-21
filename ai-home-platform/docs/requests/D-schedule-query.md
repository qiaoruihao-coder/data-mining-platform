# D：排期按需求与版本读取

- 角色：D
- 状态：已提供；排期变更写回仍未开放。
- 目标：让同一 `demandId` 读取数据库中的最新排期或指定版本，避免页面只能拿固定演示数据。

## 接口

- `GET /api/schedule` 保留无参数演示入口，返回固定排期并标记 `meta.source: "mock"`。
- `GET /api/schedule?demandId=<id>` 读取该需求的最新版本；`version` 省略时按版本号降序选择。
- `GET /api/schedule?demandId=<id>&version=<n>` 精确读取指定版本。
- `demandId` 或 `version` 重复、空白或非法时返回 400 `VALIDATION_ERROR`。
- 没有对应排期版本时返回 404 `SCHEDULE_NOT_FOUND`；数据库异常或排期 JSON 不符合 `Schedule` 契约时返回 503 `SCHEDULE_UNAVAILABLE`，不回退演示数据。

演示需求 `demo-demand` 的数据库种子仍标记为 `mock`；其他需求排期若来自 Prisma 则标记为 `live`。本次不实现 `POST /api/schedule`，也不修改 A 的页面调用方。
