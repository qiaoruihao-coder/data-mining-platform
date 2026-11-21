# 变更请求 · 全局视觉基线（A 提出，需 D 落地）

- 提出人：A
- 涉及归属：`tailwind.config.ts`、`src/app/globals.css`、`src/app/layout.tsx`、`src/components/ui/**` —— 全部归 **D**，A 不自改。
- 现状问题：`theme.extend` 为空，`globals.css` 只有 12 行；全站用裸 `slate/teal` 类名，四人各写各的必然字号、圆角、间距、主色不统一。项目呈现权重高，这一项必须在功能开发早期定死，否则最后返工。
- 参考实现：`src/features/a/ui.tsx`（A 的模块内基线，已用在需求澄清页，可直接看效果）。

## 一、请新增的 token（`tailwind.config.ts` → `theme.extend`）

```ts
colors: {
  brand: { DEFAULT: "#0F6E56", hover: "#0C5A47", soft: "#E7F3EF" },
  accent: { DEFAULT: "#C2681C", soft: "#FDF0E2" },
  ink: { DEFAULT: "#16242B", 2: "#4A5A60", 3: "#7A8A90" },
  line: "#E2E9EB",
  canvas: "#F3F6F7",
  danger: { DEFAULT: "#B42318", soft: "#FEF3F2" },
  warn: { DEFAULT: "#8A5A06", soft: "#FEF6E7" },
},
borderRadius: { card: "14px", control: "10px", input: "9px" },
fontFamily: { sans: ['system-ui', '"Microsoft YaHei"', "sans-serif"] },
```

语义约定（全组统一，写进 README 即可）：

| 用途 | 类名 |
|---|---|
| 主按钮 | `bg-brand text-white hover:bg-brand-hover` |
| 次按钮 | `border border-line bg-white hover:border-brand hover:text-brand` |
| 卡片 | `rounded-card border border-line bg-white p-5` |
| 正文/次要/弱化文字 | `text-ink` / `text-ink-2` / `text-ink-3` |
| 状态：进行中 / 待处理 / 已完成 / 异常 | `brand` / `accent` / `ink-3` / `danger` |

**禁止**：组件内写裸十六进制色值或 `slate-*`、`teal-*`、`emerald-*` 等与上表不一致的颜色。新增颜色先提变更请求。

## 二、请落地的基础组件（`src/components/ui/`）

单位与尺寸按 `src/features/a/ui.tsx` 对照即可，接口建议：

| 组件 | 签名要点 |
|---|---|
| `Button` | `variant: primary \| secondary \| ghost \| danger`、`size: md \| sm`、`disabled` |
| `Card` | 容器，`p-5`、圆角 14、1px 边线 |
| `Badge` | `tone: brand \| accent \| neutral \| danger` |
| `Field` | `label` + 可选 `hint` + 子元素，统一 label 字号 12.5 |
| `Note` | `tone: info \| warn \| danger \| ok`，用于错误/提示/未开放 |
| `Empty` | `title` + `hint` + `action`，所有列表页无数据时必须使用 |
| `SectionHead` | 卡片标题 + 右侧 aside（徽标/按钮） |

## 三、请改造 `layout.tsx`（当前是开发工作台，业主看不懂）

现在顶栏是「业主端 · A / 匹配 · B / 报价 · B / 服务方 · C / 管理端 · C」，是给组员找文件的，不是产品导航。

要求：
1. 顶栏左侧：品牌名「智装 · AI 家装履约平台」（可保留小字副标题）
2. 顶栏右侧：**身份切换触发器**（业主 / 服务方 / 平台运营）+ 当前身份显示
3. 按身份渲染对应导航项，不再出现「· A / · B」这类分工字样（分工信息留在 `/` 工作台页即可）
4. 内容区 `max-width: 1080px` 保留，背景用 `canvas`

> 说明：真正的登录认证由 D 与后续任务决定；本轮只要求「身份可选、导航随之变化」，演示时能分区即可。

## 四、首页 `/` 的处理建议

保留现有「四模块工作台」作为组内入口，但建议加一行提示「本页为组内开发工作台，产品入口见右上身份切换」，避免评委误以为这是产品首页。

## 五、验收标准

- [ ] `npm run check` 全绿
- [ ] 任意页面不再出现 `teal-*`、`slate-*` 作为主色（可用 `grep -r "teal-700" src` 自查）
- [ ] 顶栏可按身份切换，且不出现 A/B/C/D 字样
- [ ] 至少 Button / Card / Badge / Note / Empty 五个组件可被 A/B/C 直接 import
- [ ] 四个角色的页面放在一起看，卡片圆角、字号、主色一致

## 六、过渡期方案（D 未合并前）

A 已在 `src/features/a/ui.tsx` 内自建同名 API 的组件，类名常量集中在 `C` 与 `T`，但**仅限 A 自己的页面使用**——B/C 不得跨模块 import `@/features/a/ui`（跨角色 import 会违反 `scripts/ownership.mjs` 的边界规则，「只读复用」也不能绕过检查）。

正确路径：**D 先把 Button / Card / Badge / Field / Note / Empty 放入 `src/components/ui/`（共享 ui 归 D），然后 B/C 从 `@/components/ui` 复用**。在 D 落地之前，B/C 维持现有样式不动，避免三套样式并行、也避免违规导入；A 侧组件的接口签名以本文件第二节为准，D 迁移时保持一致即可，A 迁移到全局组件的改动量为零。
