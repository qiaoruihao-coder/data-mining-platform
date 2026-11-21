# C：服务方端与平台管理端

## 允许修改
src/app/provider/、admin/；src/components/StatusBadge.tsx；src/features/c/；tests/C-*
精确边界见 docs/OWNERSHIP.md 和 scripts/ownership.mjs。

## P0
先做需求大厅→需求详情→提交报价表单→我的接单。数据从公共接口读取，报价提交到 B 的接口。接入未实现时明确显示状态，不在页面自造持久化结果。然后做平台看板和售后工单页面。

## P1（P0 通过再做）
工单分类、关联需求、责任服务方和状态跟踪；舆情看板只基于真实工单或标注的模拟数据。

## 验收
表单校验及错误/空状态齐全；提交结果能被业主查看；工单能追溯到原项目和服务方；角色导航不冒充登录鉴权。

## 给 AI 的约束
- 读取 AGENTS.md 和 docs/API.md，使用 src/contracts，不自行声明替代 DTO。
- 未归属的文件只读。需要共享改动写 docs/requests/C-主题.md，交对应负责人处理。
- 模块私有样式和组件放自己目录，不改全局主题和依赖。
- 先列本次文件范围，再实现一个小功能，跑检查并交付；不要一次包揽全部 P1。
- 运行 npm run scope -- --role C --base origin/main。

## 本机演练记录
待本角色成员填写。
