# A 集成预检：把 D 的两个分支合并后的实测结果

日期：2026-11-13 · 验证人：A · 方式：临时分支 `tmp/a-plus-d`（本地，未推送），
依次合并 `origin/feature/D-demand-contracts`、`origin/feature/D-demand-crud`，再与 A 的分支合并跑全套检查。

结论：**A 的代码与新契约完全兼容**，但两个 D 分支一起合并时会撞两个问题，请 D 在开 PR 前先处理。

## 问题 1：`DemandInputDTO` 重复导出（会导致 tsc 失败）

两个分支各自在 `src/contracts/index.ts` 里加了一次同样的类型导出：

```
src/contracts/index.ts(56,13): error TS2300: Duplicate identifier 'DemandInputDTO'.
src/contracts/index.ts(69,13): error TS2300: Duplicate identifier 'DemandInputDTO'.
```

- `feature/D-demand-contracts` 在文件末尾新增块里加了一次；
- `feature/D-demand-crud` 在既有类型区加了一次。

git 能自动合并（两处位置不同），所以不会报冲突，但类型检查会直接失败。
建议：保留一处（建议放在既有类型区，和 `DemandDTO` 挨着），删掉末尾那份。

## 问题 2：合并后需要重新生成 Prisma Client（否则 tsc 报错）

```
src/lib/demand.ts(1,15): error TS2305: Module '"@prisma/client"' has no exported member 'DemandOrder'.
```

`prisma/schema.prisma` 里其实已有 `DemandOrder` 模型（main 上就有），只是 `node_modules/.prisma` 里的类型是旧的。
执行 `npm run db:generate` 后该错误消失。CI 里如果缓存了 Prisma Client，需要确认 generate 在 typecheck 之前跑。

## 实测：D 的 CRUD 已经能真跑通

本地 `cp .env.example .env && npm run db:setup` 后：

| 步骤 | 结果 |
| --- | --- |
| `POST /api/demand`（A 确认需求时的 payload） | **201**，`meta.source: "live"`，返回新 id `cmwf4vpej0001…` |
| `GET /api/demand` | 2 条，`source: live`，新需求排在第一条 |
| `GET /api/demand/{id}` | **200**，字段与契约一致 |

也就是说合并后 A 的「确认需求」按钮会立刻从「501 未开放」变成真实落库，A 侧不需要改代码
（`interpretDemandSubmit` 已处理 2xx + envelope 的成功分支，并会显示 `来源：live`）。

## 顺带修掉的一个问题（已在 A 的 PR #6 内）

列表底部原来写死「当前列表来自 mock 接口，只返回演示需求」。
D 的 GET 变成 `live` 之后这句话就是错的，已改为按 `source` 分情况显示：
`live` 时说「来自真实数据库，落库的需求会立即出现」，`mock` 时保留原说明。

## 建议 D 的合并顺序

1. 先合 `feature/D-demand-contracts`（契约 + 文档）；
2. 再合 `feature/D-demand-crud`，合并时注意删掉重复的 `DemandInputDTO`；
3. CI 确保 `db:generate` 在 `typecheck` 前执行。

A 侧继续按「合并后再切换调用方」的约定：等 `GET /api/demand/[id]` 进 main 后，
再把详情页从「列表里按 ID 查」改为直接用按 ID 接口（当前实现已能工作，不阻塞演示）。

## 复检（2026-11-14 00:0x，PR #8 / #9 已开出）

在 `tmp/a-plus-d3` 上重新做了一遍：main（a999e40）+ `feature/D-demand-contracts`(#9) + `feature/D-demand-crud`(#8) + A 分支。

- **`DemandInputDTO` 重复导出问题依然存在**：`src/contracts/index.ts(56,13)` 与 `(69,13)`。
  删掉第二处（CRUD 导出块里那个）后 tsc 通过。
- `npm run db:generate` 仍是必需前置，否则报 `DemandOrder` 未导出。
- 去重后全套 **94 条测试通过**，A 与两个 D 分支完全兼容。
- 两个分支都是基于旧 main 拉的（`git diff origin/main` 会显示删除 B/C 文件），
  这是基线落后的假象，真实合并不会删文件；建议 D 合并前先 `git merge origin/main` 减少噪音。

## A 侧的详情页已改成「按 ID 优先 + 列表回退」

A 不再等 #8 合并：详情页 `useDemandDetail` 先打 `GET /api/demand/[id]`，
命中就用它（`via=byId`）；遇到 404/501/5xx/结构不合法/id 不符/网络异常时自动回退到
`GET /api/demand` 按 ID 查找（`via=list`），并在页面上标注本次走的是哪条路径。

两条路径都实测过：

| 场景 | 请求链路 | 页面标注 |
| --- | --- | --- |
| main（无按 ID 接口） | `404 /api/demand/demo-demand` → `200 /api/demand` | 来源 mock · 列表回退 |
| #8 合并后 | `200 /api/demand/{id}`（只发这一次） | 来源 live · 按 ID 查询 |
| 不存在的 ID | `404 /api/demand/not-exist-999` → `200 /api/demand` | 没有找到这条需求（如实提示） |

也就是说 #8 一合并，A 的详情页自动切到新接口，不需要再改代码。
