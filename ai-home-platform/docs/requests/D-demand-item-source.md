# D：需求逐条来源字段

- 角色：D
- 状态：已实现
- 关联请求：`docs/requests/A-demand-item-source.md`

## 契约与来源

`src/contracts/index.ts` 新增共享 `Source` 枚举和 `SourceDTO` 类型，并在公共 `Demand` 输出中增加可选字段 `source?: "mock" | "live"`。字段是输出信息，不进入 `DemandInput` 或 `DemandUpdateInput`；写入契约保持 strict，客户端不能指定来源。

需求服务在返回数据库记录时始终填充逐条来源：固定 `demo-demand` 为 `mock`，其他数据库记录为 `live`。整体响应仍使用 `meta.source`：列表只要混入演示需求就保持 `mock`，不改变既有信封语义。静态 mock 需求继续通过现有 `mock` API 信封标识，不把来源字段混入写入测试输入。

字段缺失表示来源未知，客户端不得把缺失或 `simulated: false` 推断成 `live`。未知来源和接口失败不能回退成演示数据。

## 验收

- 混合需求列表中的每条记录可分别看到 `mock` 或 `live`，同时整体 `meta.source` 仍按既有规则返回。
- 演示需求详情返回 `source: "mock"`，新建/数据库需求详情返回 `source: "live"`。
- `source: "mock"`、`source: "live"` 之外的值被拒绝；创建和更新带 `source` 被拒绝。
- 共享客户端和响应基础设施使用 `src/contracts` 的 `SourceDTO`，不重复声明来源联合类型。
