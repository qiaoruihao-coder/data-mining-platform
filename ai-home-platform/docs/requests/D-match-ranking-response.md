# D 回复 B #133：档期与履约评价数据口径

日期：2026-11-14。对应 `B-match-ranking-contract.md`。以下为 D 确认的共享实现方向，不是已经上线的 Provider 字段；本次照片 PR 不实现排序或聚合接口。共享契约及适配器须另一个可验收 PR 合入后，B 再接入。

后续进展：评价汇总第一阶段的具体实现、冻结字段、公开目录边界及 B 接线入口见 `D-provider-performance.md`；固定 mock 档期样例已由 `D-provider-availability.md` 交付。下文保留 #138 时的原始决策；B 排序仍未实现。

## 来源与字段决定

1. **档期先提供固定 mock 窗口**，采用 B 提议的 `availability` 字段：`windows`、`coverageStartDate`、`coverageEndDate`、`updatedAt`、`validUntil`、`source`。演示日期与更新时间固定写入样例，不随读取自动续期，不从接单/排期/预计施工天数推算实际产能。到期显示“档期待更新”，不参与排序。真实档期维护人、维护入口和多班组容量尚未实现，不能输出 live。
2. **履约指标采用“已完成接单的业主评价均分＋样本数”**，接受 `performance.basis=completed_order_review_average`，以及 `averageRating`、`reviewCount`、`calculatedAt`、`source`。均分四舍五入到两位，无样本必须 `null/0`。不使用 Provider.rating 补齐，也不称准时率、质量认定或信用分。
3. **mock/live 严格分开统计**。后续共享只读适配器明确接收统计来源，计划由 `GET /api/provider?performanceSource=live|mock` 选择一种口径，缺省 live；成功查到无 live 样本即 `null/0/live`，不得回退 mock。演示样本须由合成的完整接单/完工/评价关系产生，不能只填均分。Provider 基础资料、档期、评价各自保留 source；整体混合/未知保守 mock，全 live 才整体 live。

## 聚合范围与异常

- 仅统计 DemandOrder、ServiceOrder 均 completed，Review.orderId 对应同一需求、服务方和业主的记录；接单及其 accepted 报价、评价来源须一致。一接单最多一评价，重放不增加样本。
- 旧的无 orderId 评价明确不在统计口径内；未完成关系不计入。发现绑定关系损坏或非法/矛盾来源应报 503，不能静默跳过后宣称完整统计。数据库故障与合法无样本分开。
- 同意与现有服务方目录相同的公开汇总范围，仅对目录中的服务方返回均分、样本数、来源和服务端快照时间；不公开评论、业主、需求/接单 ID。不是将受保护的本人评价接口变成公开接口。
- 日期采用 Asia/Shanghai 自然日，窗口有明确覆盖区间，合法、排序、不重叠；空窗口只表示覆盖区间内无档期。未来更新时间、无效时间区间拒绝；截止时刻即失效。实时快照计算评价，首版不加缓存。

## B 接线与交付顺序

先由 D 独立交付评价汇总公共 schema、接口和只读适配器，再交付固定 mock 档期。两者均不需要新依赖；字段按 B 提议可选/可空以兼容旧 Provider。浏览器与 `/api/match` 复用同一基础数据读取方式，不能一处新接口、一处固定旧数组。

接受 B 的首版排序边界：城市/工种硬过滤；新增维度仅在基础同分组内、来源一致且全组数据有效时启用，未知不淘汰、null 不当零。评价至少 1 个有效样本才有均分；少于 3 个显示低样本提示。档期只能判断窗口可容纳 desiredDays，不能保证截止日或施工承诺。B 后续补稳定性与传递性测试，实际优先级在对应共享实现交接中一并确认。

本次交付的是答复和边界决定；Provider 新字段、汇总查询及固定档期样例已分别交付，仍待独立实现的是 B 排序/展示。现有演示 Provider.rating 不变，也不改名为履约评分。
