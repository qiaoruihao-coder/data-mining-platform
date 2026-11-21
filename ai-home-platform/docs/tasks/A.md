# A：业主端与需求澄清

## 允许修改
src/app/owner/（排除 matches/quotes）；src/components/ChatWindow.tsx、DemandCard.tsx、GanttChart.tsx；src/features/a/；tests/A-*
精确边界见 docs/OWNERSHIP.md 和 scripts/ownership.mjs。

## P0
先完成需求澄清聊天 UI，调用 POST /api/demand/chat；显示 mock 标识、加载/错误状态、缺失信息；用户确认结构化需求后调用 D 的 POST /api/demand。若该写入仍返回 501，显示未开放，不能伪造保存成功。随后做需求列表、详情，并链接到 B 的匹配/报价页面。

## P1（P0 通过再做）
施工进度、依赖和负责人展示；模拟付款时间线。AI 照片检查只提示疑点，不能声称自动验收合格。

## 验收
聊天可输入、可重试；结构化需求可确认；同一需求 ID 贯穿链接；不存在静默忽略 400/501 的假成功。

## 给 AI 的约束
- 读取 AGENTS.md 和 docs/API.md，使用 src/contracts，不自行声明替代 DTO。
- 未归属的文件只读。需要共享改动写 docs/requests/A-主题.md，交对应负责人处理。
- 模块私有样式和组件放自己目录，不改全局主题和依赖。
- 先列本次文件范围，再实现一个小功能，跑检查并交付；不要一次包揽全部 P1。
- 运行 npm run scope -- --role A --base origin/main。

## 本机演练记录

### 2026-11-13 feature/A-demand-chat（P0：需求澄清聊天）
- 环境：Windows，Node 22.22.2（符合 .nvmrc 22），npm ci 全新安装。
- `npm run check`：lint 通过；tsc --noEmit 通过；17 个测试全过（含 A 新增 9 条）；模块导入边界通过。
- `npm run build`：生产构建成功（/owner/demand/chat 18.9 kB）。
- `npm run scope -- --role A --base origin/main`：通过，8 个变更文件，无越界。
- 运行时验证（next start 后实测）：/owner/demand/chat 返回 200；POST /api/demand/chat 返回 mock 信封与 6 个 missingFields；POST /api/demand 返回 501，页面显示“需求保存尚未开放”，无假成功。
- 使用 mock：对话为 mock 固定追问，未调用真实模型；需求保存依赖 D 的 POST /api/demand。
- 待办（P0 剩余）：需求列表页；详情页接 GET /api/demand/[id]（等 D）；服务方标签映射待 B 联调。
- 已提共享变更请求：docs/requests/A-api-post.md（请 D 新增 apiPost）。

### 2026-11-13 feature/A-demand-chat（P1：施工进度 + 付款时间线）
- 交付：`/owner/project/[id]` 重做（SchedulePanel：4 项统计卡、真实甘特条、工序清单、可开工任务、排期自检、变更/验收诚实提示）；`/owner/payments/[id]` 重做（PaymentsPanel：金额汇总卡、节点时间线、付款自检、资金安全说明）。
- `src/components/GanttChart.tsx` 重写为纯展示甘特图（只收 props，按天百分比定位，C 端可复用）。
- 新增：features/a/schedule.ts、payments.ts、useSchedule.ts、usePayments.ts、SchedulePanel.tsx、PaymentsPanel.tsx。
- 测试：A-schedule（10 条）、A-payments（7 条）新增；全套 39 条通过。
- `npm run check` 通过（lint/tsc/测试/边界）；`npm run build` 通过；scope --role A 通过。
- 运行时验证：/owner/project/demo-demand 与 /owner/payments/demo-demand 均 200，无头截图确认布局与数据渲染正常。
- 数据边界：schedule/payment 只显示「第 N 天」相对工期（契约无真实日期字段）；demandId 不一致时提示而非冒充；POST 均 501，页面按钮给出诚实反馈。
- 已提共享变更请求：docs/requests/A-schedule-payment.md（真实日期、责任方姓名、验收回写、付款比例/到期日/凭证、PaymentDTO 类型导出）。

### 2026-11-13 feature/A-demand-chat（导航打通）
- 列表卡片加五阶段进度条（需求澄清→匹配报价→签约定标→施工中→已完工），与契约 status 一一对应；签约后按钮切换为「施工进度 / 节点付款」。
- 需求详情右侧新增「施工与资金」卡片，含施工/付款入口与签约前如实提示；打通 /owner/project/[id]、/owner/payments/[id] 的可达路径。
- demand-list.ts 新增 STAGES、stageIndex、isPostContract；A-demand-list 测试 +2 条，全套 41 条通过；check/scope/build 全过；截图验证列表与详情渲染。

### 2026-11-13 同步远端 + 新开 PR #6
- 发现 PR #3 已在 49e0b49 处被合并进 main（1965222），此后 A 的三个提交未入 main。
- 将 origin/main（含 B 匹配、C 需求大厅）合并进 feature/A-demand-chat，无冲突；集成后 60 条测试全过、check/scope/build 通过。
- 开新 PR #6：A(P1) 施工进度甘特图、节点付款时间线与业主端导航打通。
- 移动端实测：puppeteer 390px 下 5 个业主页 scrollWidth=390，无横向溢出（此前 CLI 截图的"截断"为视口假象）。
