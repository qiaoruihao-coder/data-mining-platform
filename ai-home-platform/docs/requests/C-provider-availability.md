# C：管理端服务方档期只读查看

2026-11-14，基于已合入 D 档期交接的 main（a212c25），在 `feature/C-provider-availability` 完成一块独立验收。无需新增公共契约、接口、依赖或配置；本次不包含待合入的报价筛选 PR #150。

## 入口与行为

从 `/admin/tickets` 的责任服务方链接进入 `/admin/provider/[id]`，沿用 `GET /api/provider`、公共 `Provider` 校验及精确编号匹配，展示基础资料和档期。目录查询、基础资料、档期分别披露来源；旧 DTO 缺少基础资料来源时明确未知，不继承目录来源。

- 档期缺省或 null：未知，不推断没有可用窗口，不虚构日期或来源。
- 未过期且 windows 为空：仅说明本次覆盖区间内没有已确认窗口。
- 未过期且有窗口：保留多段及单日窗口，按 Asia/Shanghai 自然日闭区间显示；同时给出覆盖范围、更新时间、有效截止和档期来源。
- 达到有效截止（当前设备时间大于等于 validUntil）：显示“档期待更新”，不再展示旧窗口或空窗口结论；仍保留元数据方便核对。
- 初始渲染不读取时钟，客户端就绪后核对有效期；在截止时、最长每分钟及 focus/visibilitychange 时复核，卸载时清理定时器与事件监听。设备时钟偏差仍会影响过期判断，页面明确说明使用当前设备时间。
- 刷新重新查询目录；加载、失败或未找到目标时不显示旧档期。坏档期由公共契约拒绝整批响应，501（包括成功形状的响应）仍是失败。

## 模拟部分与限制

当前公开目录的基础资料和固定档期样例来自 D 的 mock 数据，页面明确标记。测试使用合成数据验证独立 mock/live 来源，没有新增运行时假数据或失败回退。资料仅供核对，不代表服务方认证、预约、锁定或施工承诺。

未实现真实档期维护/编辑、预约锁定、派单、容量管理或 B 的档期排序。当前无管理员登录鉴权；沿用公开资料页的权限提示。目录中任一坏评价/关联可能造成整体 503 的既有限制仍存在，本轮不修改 D 接口。

## 验收记录

- 档期与资料页专项：22/22 通过，涵盖空值、空窗口、多段/单日、截止前/等于/后、时区偏移、合法未来更新时间、独立来源、坏 DTO、501/503/网络失败和刷新更新。初次专项测试发现 React 静态 HTML 属性大小写与测试断言不一致，已改为大小写不敏感的语义断言并全部通过。
- `npm.cmd run check`：908/908 通过，lint、typecheck 和 boundaries 全部通过。显式使用本轮新建并 seed 的临时 SQLite 数据库，未修改已有 `.env` 或用户数据库。
- `npm.cmd run build` 通过；`node scripts/run-production-smoke.mjs` 通过（13 页面、32 GET、13 POST 基础场景及照片、履约、评价和来源隔离链路），runner 已停止本次子进程。
- 生产浏览器验收通过：售后工单责任方链接进入 provider-a 单段档期，刷新保留正确内容；provider-b 显示两段，provider-d 显示覆盖区间内无窗口，provider-e 显示未知。390×844 窄屏档期区换行正常，无横向溢出；验证后恢复视口。截止边界/过期及失败场景由上述自动测试覆盖，没有修改系统时钟或拦截接口伪造实际数据。
- `npm.cmd run scope -- --role C --base origin/main` 通过，共六个 C 文件；`git diff --check` 通过。提交前已 fetch，origin/main 仍为 a212c25。

## 文件范围

`src/features/c/AdminProviderDetail.tsx`、`src/features/c/ProviderAvailability.tsx`、`src/features/c/provider-availability.ts`、`tests/C-admin-provider-detail.test.ts`、`tests/C-provider-availability.test.ts` 和本记录，共六个 C 允许文件。
