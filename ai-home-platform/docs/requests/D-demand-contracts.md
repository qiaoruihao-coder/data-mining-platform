# D：需求 CRUD 契约与实现

- 角色：D；状态：已实现，待本 PR 合入。
- 原因：P0 要求先冻结写入/详情契约，A/B/C 需要稳定字段后才能集成。
- 文件：src/contracts/index.ts、src/lib/demand.ts、src/app/api/demand/[id]/route.ts、tests/D-demand-crud.test.ts、docs/API.md。
- 创建：POST /api/demand 使用现有 DemandInput，全部字段必填；金额为非负安全整数分，下限不超过上限。成功 201 envelope(Demand)，id/status 由服务端生成，初始 published。
- 详情：GET /api/demand/[id] 使用 DemandIdParams；id 为非空白字符串，成功 200 envelope(Demand)，不存在 404/DEMAND_NOT_FOUND。
- 更新：PUT /api/demand/[id] 使用 DemandUpdateInput（完整替换可编辑字段，与 DemandInput 相同），draft 或尚未签约的 published 可更新；contracted、in_progress、completed 返回 409/INVALID_STATE。成功 200 envelope(Demand)。不支持 PATCH，避免部分预算绕过交叉校验。
- 删除：DELETE /api/demand/[id] 允许删除没有关联记录的 draft 或尚未签约的 published；成功 200 envelope(DemandDeleteResult)，data={id,deleted:true}；不存在 404，已签约或进入履约流程后 409。`demo-demand` 只读；已有报价、排期、付款、评价或工单关联时返回 409/DEMAND_HAS_RELATED_RECORDS。
- 输入拒绝 id/status/未知字段；不提供状态变更端点。description/city 去除首尾空白并拒绝空白，面积拒绝非有限数。
- 兼容：不修改现有 Demand 响应形状；新契约为增量导出。既有 mock 保留来源；没有新增依赖或数据库变更。
- 影响：A 后续提交和详情、B/C 后续真实查询；本 PR 补齐 PUT/DELETE 路由和 Prisma 数据访问，演示需求保持只读，关联记录保护避免外键错误暴露为 503；鉴权与数据隔离仍需后续接入。
- 验收：契约测试覆盖输入、预算、来源、状态限制、更新和删除结果；check/build/scope 通过。
