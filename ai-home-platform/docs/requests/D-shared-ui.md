# D 共享 UI 出口

- 申请角色：D
- 目标文件：`src/components/ui/index.tsx`
- 状态：已落地，等待 A/B/C 在各自模块中切换导入

## 目的

跨角色页面不能导入 `src/features/a/ui.tsx`。边界检查按文件 owner 判断，
即使调用方只读复用，也会被视为 A/B/C 跨模块业务导入。D 现在提供共享 UI 出口，
各角色应从 `@/components/ui` 引入基础组件。

## 导出

- `T`、`C`：视觉常量和类名常量
- `Button`、`Card`、`Badge`、`Field`、`Note`、`Empty`、`SectionHead`

共享组件保持 A 当前基线的调用签名，方便调用方只替换 import 路径；focus ring 使用
Tailwind 可识别的 `focus:ring-[#0F6E56]/[0.12]` 写法。

## 迁移约定

- A 继续维护 `src/features/a/ui.tsx` 的过渡实现，后续自行切换到 `@/components/ui`。
- B/C 新增页面直接使用 `@/components/ui`，不要导入 `@/features/a/ui`。
- 本次不改 A/B/C 业务文件，也不改变业务组件归属。
