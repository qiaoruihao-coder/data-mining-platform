# D：视觉升级第 1 阶段（全局基线 v2）

## 范围

只改 D 负责的全局样式、共享 UI、顶栏与首页；不改 A/B/C 业务文件、接口、数据库、依赖或 mock 数据。

| 文件 | 变更 |
|---|---|
| `tailwind.config.ts` | 色板 v2：石灰白底 `canvas #F3F5F2`、松绿 `brand #1A5E4A`、扶手木 `wood #8F6234`（`accent` 保留为同值别名）、印泥红 `seal #BF3A2B`（仅验收章）；`ink-3` 改为 `#66736F`，白底对比度约 4.9:1；新增圆角 `panel/tag`、阴影 `float`、字体 `song` |
| `src/app/globals.css` | 正文 16px / 行高 1.75；h1 30、h2 22、h3 18；`.num` 等宽数字；全局 `:focus-visible`；尊重 `prefers-reduced-motion` |
| `src/components/ui/index.tsx` | `T`、`C` 换肤：按钮 15/14px、输入 16px、标签 14px、辅助信息最小 13px；静态卡片去阴影 |
| `src/components/ui/FulfillmentRuler.tsx` | 新增“履约尺 + 验收章”：五个节点对应 `draft → published → contracted → in_progress → completed`；`compact` 为卡片内缩略版；`animateStamps` 仅在用户确认后使用 |
| `src/components/ui/AccountMenu.tsx`、`OwnerLogin.tsx`、`DemoProviderLogin.tsx` | 两个登录面板收进顶栏右上角浮层；登录逻辑、请求、说明文字不变；浮层关闭时组件保持挂载，会话刷新照常 |
| `src/components/RoleNavigation.tsx`、`src/app/layout.tsx` | 身份切换改为三段按钮（仍只切换导航）；当前导航项下划线 |
| `src/app/page.tsx` | 保留 #171 的四个入口与演示说明，新增标题区和模拟演示项目的履约尺 |

## 给 A/B/C 的迁移约定（第 2 阶段）

- 共享组件和 `C` 类名常量已自动换肤；仍使用裸 `slate-*`、`teal-*`、`amber-*` 或手写十六进制色值（含 `src/features/a/ui.tsx`）的位置不会跟随，请替换为 token：`text-ink / ink-2 / ink-3`、`bg-brand-soft`、`bg-wood-soft text-wood` 等。
- 字号不低于 13px；正文用 16px，辅助信息用 `text-meta`（13px）。
- 链接和按钮文字末尾不加“→”；标题和状态不要用“ · ”拼接，状态拆成单独徽标。
- 需要展示履约阶段时使用 `FulfillmentRuler`（`@/components/ui`），印泥红只用于验收章。

## 验证

- 使用 `DATABASE_URL=file:./ci.db AI_MODE=mock` 并重建 `prisma/ci.db`：`npm run check` 1016/1016 通过；`npm run build` 通过；`node scripts/run-production-smoke.mjs` 通过；`npm run scope -- --role D --base origin/main` 通过；`git diff --check` 通过。
- 浏览器核对：桌面 1280 与手机 390 宽度下首页无横向溢出；登录浮层可展开，演示服务方登录与退出后顶栏状态同步更新，Esc 可关闭；浏览器控制台无错误。

## 第 2 阶段：A/B/C 文件统一换色（集成人统一修改）

由集成人决定统一修改，不再分给 A/B/C 各自处理。本阶段只替换类名，不改文案、结构、接口或测试；会改到 A/B/C 的文件，因此 `check-scope --role D` 会报越界，属预期。

- `src/features/a/ui.tsx` 的 `T`、`C` 改为转出 `@/components/ui` 的共享常量，组件签名不变。
- 写死的十六进制色值与 `slate/teal/amber/red` 默认色板全部替换为 token，例如 `#16242B → ink`、`#0F6E56 → brand`、`#7A8A90 → ink-3`、`#E2E9EB → line`、`slate-600 → ink-2`、`teal-800 → brand-hover`、`amber-50 → warn-soft`、`red-700 → danger`；`#A8B4B8` 的提示文字改为 `ink-3`，提升对比度。
- 新增 token：`mist`（`#EDF0EE`，中性浅底）、`line-strong`（`#C5CEC9`，较深分隔线）。
- 字号下限：`text-xs`、`text-[11px]`～`text-[12.5px]` 统一为 `text-[13px]`，`text-[13.5px]` 改为 `text-[14px]`。
- 替换后 `src/` 内（除共享 token 定义和履约尺的刻度渐变外）无写死色值、无默认色板颜色类、无小于 13px 的字号。

验证：重建的 `ci.db` 下 `npm run check` 1016/1016、`npm run build`、`run-production-smoke.mjs` 均通过；浏览器核对业主需求列表、施工进度、服务方匹配、运营看板与服务方需求大厅，其他演示页 HTTP 200，控制台仅有未登录时预期的 401。

## 第 3 阶段：逐页精修

新增共享组件（`@/components/ui`）：

| 组件 | 用途 |
|---|---|
| `PageHeader` | 页面开屏：标题 + 一句说明 + 右侧动作；A 的 `PageHeader` 已转为调用它 |
| `LinkButton` | 按钮样式的链接，`<a>` 内不套 `<button>` |
| `Explainer` | 折叠说明：数据来源、权限边界、演示限制等静态长文案；内容始终在 HTML 中，只是默认收起。动态状态、错误和 `aria-live` 内容不放进来 |

精修规则：开屏统一用 `PageHeader`；静态长说明收进 `Explainer`；正文 15–16px、辅助信息 13px；按钮与卡片统一用共享组件和圆角 token，静态卡片无阴影；金额等数字加 `num`；链接末尾不加“→”，标题不用“ · ”拼接；被测试或冒烟脚本断言的文字保持不变。

## 补充：盖章动画与全站出错页

- `FulfillmentRuler` 新增 `animateFrom`，配合 `newlyStampedFrom(previous, next)` 只给刚完成的节点播放盖章动画；页面首次读取、状态不变或后退都不播放，播放后清除，重新加载不会重复盖章。
- 施工进度页的“履约推进”卡片加入完整履约尺。接单状态由业主确认推进（已签约 → 施工中 → 已完工）后，新完成的节点盖章。状态记忆放在 `SchedulePanel` 外层，因为重新读取时 `OrderProgressPanel` 会被卸载。
- 新增 `src/app/not-found.tsx`、`src/app/error.tsx`、`src/app/global-error.tsx`，与新视觉一致；出错页只显示错误编号，不展示内部错误详情。
- 新增 `tests/D-fulfillment-ruler.test.ts` 覆盖盖章起点与动画范围。
