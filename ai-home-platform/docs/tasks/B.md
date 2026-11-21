# B：智能匹配与透明报价

## 允许修改
src/app/owner/matches/、quotes/；src/app/api/match/、quote/；src/lib/match.ts、quote-engine.ts（或同名子目录）；src/components/ProviderCard.tsx、QuoteTable.tsx；src/features/b/；tests/B-*
精确边界见 docs/OWNERSHIP.md 和 scripts/ownership.mjs。

## P0
先实现匹配规则与页面，再实现报价对比。GET 接口由固定需求改为按 demandId 读取真实需求，需求查询能力由 D 提供。POST /api/quote 与 C 的提交表单共用同一契约；新增写入类型先交 D 合入。代码汇总金额，AI 仅解释差异。不能把未知费用视为零或把套餐范围不同的报价直接判最低。

## P1（P0 通过再做）
结合可用工期和履约评分改进排序；实现不一致单位/缺项提醒。

## 验收
异地/错误工种能被过滤；结果说明排序依据；已知总额由明细计算；待确认费用保留；C 提交后 A/B 页面能看到报价。

## 给 AI 的约束
- 读取 AGENTS.md 和 docs/API.md，使用 src/contracts，不自行声明替代 DTO。
- 未归属的文件只读。需要共享改动写 docs/requests/B-主题.md，交对应负责人处理。
- 模块私有样式和组件放自己目录，不改全局主题和依赖。
- 先列本次文件范围，再实现一个小功能，跑检查并交付；不要一次包揽全部 P1。
- 运行 npm run scope -- --role B --base origin/main。

## 本机演练记录
待本角色成员填写。
