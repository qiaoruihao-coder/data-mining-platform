# B：评价均分同分排序及目录适配器边界请求

基线 main `54bd490`，已合入 D #141。当前交付状态：**B 实现已通过专项、构建及浏览器/HTTP 验收；公共导入边界需 D 补齐后才能通过全量 check，不能直接合并。**

## 给 D 的具体变更请求

`D-provider-performance.md` 与 `docs/API.md` 明确允许 B 服务端调用 `readProviderDirectory`，但 `scripts/check-boundaries.mjs` 尚未放行，因此当前 `npm run check` 的 D-boundaries 测试加载扫描器时报告：

```text
src/app/api/match/route.ts -> src/lib/provider-directory.ts
src/lib/match/data.ts -> src/lib/provider-directory.ts
```

请 D 独立修改 `scripts/check-boundaries.mjs` 与 `tests/D-boundaries.test.ts`，只允许以上两个 B 服务端文件导入目录适配器，并要求 `clientReachable === false`。建议判断条件：

```ts
const matchCanReadProviderDirectory = !clientReachable
  && (file === "src/lib/match/data.ts" || file === "src/app/api/match/route.ts")
  && target === "src/lib/provider-directory.ts";
```

将该条件纳入允许列表，并测试客户端可达路径仍拒绝，`src/lib/match.ts`、B 页面/组件、A/C 业务模块及伪造相邻路径均不因此获得直接读取权限。不要扩大整个 `src/lib/` 的权限。B 的浏览器保持 `apiGet('/api/provider', Provider.array())`；本请求不申请浏览器直接读取服务端实现，不改公共 DTO、依赖或配置。

B 本分支保留直接、可审查的适配器导入，未改检查脚本、动态拼接导入、复制 D 聚合算法或静默回退种子数据。D 修复合入后需同步并重新跑全量检查。

## 已实现行为

- 城市及施工工种先硬过滤；原标签 60 分加基础资料评分最多 40 分保持不变。评价维度不增加基础分，不改变不同基础分组顺序。
- 按完整基础同分组统一判断：组内所有评价通过公共 ProviderPerformance 校验、有非空均分、至少 1 个样本，且评价来源一致时，按均分降序。同均分按 ID，不按样本数加分。组内任一缺失/null/无样本或来源不同，整组按 ID；未知不淘汰，不当 0 分。
- 每位候选保留可读排序理由；卡片分别展示基础资料评分/来源、已完成接单评价均分/样本数/来源/服务端计算时间。0、1、2 个样本均提示“样本少”；未提供汇总与已查得 0 样本分开。评价不宣称准时率、信用分或质量认证。
- 不按浏览器时钟拒绝合法计算时间，沿用 D #141 的时钟偏差修复。
- 浏览器继续使用目录 HTTP 默认 live 口径；匹配 API 使用同一 D 适配器的默认 live 口径。没有 live 样本不取 mock 样本补齐。目录基础资料仍 mock，评价来源独立展示。
- 匹配 API（包括无参演示需求）现在也读取动态目录，成功 no-store；目录故障返回 503/PROVIDER_UNAVAILABLE，不回退固定数组。原有需求查询/参数行为保留，失败不伪装空候选。

## 范围与剩余工作

仅修改 B 的算法、服务端数据入口/路由、卡片及说明、B 测试和此记录。未改 D 的边界脚本、契约、数据库、mock 种子或其他角色模块。旧 API 测试为目录读取增加隔离的空评价快照，避免依赖本机数据库。

本次没有档期字段或档期排序，也没有统计来源切换控件；运行时默认 live。默认目录的基础分可能没有并列，且 live 评价可能无样本，因此不会为了展示重排而修改基础分或补造评价。生产服务方认证、真实档期维护及多班组容量仍未实现。

## 验证记录

- 首次 `npm.cmd run check`：lint 和类型通过；871 项通过、1 项失败（D-boundaries 文件因上述两条未放行导入退出），后续 boundaries 命令未执行。不可将其报告为全量通过。
- B 匹配专项：38/38 通过，覆盖不同基础分优先、均分相同稳定 ID、0/缺失/null/坏 DTO、mixed 来源整组降级、全排列一致与不修改输入、硬过滤、0/1/2/3 样本提示、未来服务端时间、浏览器/API 相同汇总及故障不回退。
- `npm.cmd run build` 通过。
- `npm.cmd run scope -- --role B --base origin/main` 通过，9 个文件均归 B；`git diff --check` 通过。
- 隔离 SQLite + 生产服务实际执行 `scripts/smoke.mjs` 通过：13 页面、32 GET、13 POST、3 PUT 基础场景，以及目录评价汇总、接单/履约/评价、照片等扩展链路。测试服务和浏览器在验收后停止。
- Edge 未拦截的实际页面与 `/api/match?demandId=demo-demand` 返回相同候选；隔离库无 live 样本时卡片保留 null/0/live，目录基础资料仍 mock。
- 浏览器合成目录响应将两团队基础分均设为 96，均分 4.90/1 条与 4.10/3 条，实际按 4.90 在先且仅 1 条者显示样本少；将一方改为 null/0 后整组恢复 ID 顺序。合成数据仅测试注入，没有更改运行时目录或种子。
- 模拟目录 503 后页面隐藏全部旧候选，解除拦截并重新加载恢复真实读取。390px 手机宽度实看，无整页横向溢出。
- AI_MODE=mock；目录基础资料、演示认证及相应接单/评价仍 mock。生产冒烟的 live 报价为隔离合成夹具，不能据此宣称生产服务方认证。未新增运行时假数据、AI 排序或回退。
