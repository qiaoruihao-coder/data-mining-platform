# 所有 AI 开工必读
这是四人协作的黑客松项目。产品方向参考「方案参考.md」，模块归属以 docs/OWNERSHIP.md 为准。
本仓库最初是可运行的开工骨架，不是已完成的业务平台。不要把 mock、占位页面或待开发接口描述成真实 AI/公司能力。

## 每次开工
1. 读取 README.md、docs/OWNERSHIP.md、docs/API.md、docs/WORKFLOW.md 和 docs/tasks/对应角色.md。
2. 运行 git status --short 与 git branch --show-current。先理解现有改动，不覆盖他人工作。
3. 每个成员使用自己的 clone，分支为 feature/A-xxx、feature/B-xxx、feature/C-xxx、feature/D-xxx。不直接提交 main。
4. 只修改本角色拥有的文件。共享文件或契约的变更，先在 docs/requests/<角色>-<主题>.md 写清理由、字段和影响，由 D 集成。不要自行修改 package.json、锁文件、全局样式、数据库 schema 或公共类型。
5. 页面和组件不得导入其他角色的业务模块；跨模块通过 src/contracts 和 src/lib/api-client.ts 协作。API 路由可组合本模块逻辑与 D 的基础设施。

## 契约
- src/contracts/index.ts 是字段、输入校验和返回值格式的唯一来源。不要复制一套相似类型。
- 金额统一人民币「分」的非负整数，显示时再除以 100；日期 YYYY-MM-DD，时间 ISO 8601。
- 成功 { ok: true, data, meta: { source: 'mock' | 'live' } }；失败 { ok: false, error: { code, message } }。
- 未知费用用 null，不能当作 0；模型输出要校验，金额计算和状态流转交给程序。
- mock 标识必须显示给用户。没有接通真实接口不得伪装接通。
- LLM_API_KEY 仅服务端读取，不加 NEXT_PUBLIC_ 前缀；不提交 .env、数据库、用户照片、个人资料。
- 角色切换仅是演示导航，并非身份认证。上线前必须实现鉴权和数据隔离。

## 交付
- 小步提交，一个 PR 完成一个可验收功能；不要做无关重构，不使用强推或丢弃未保存改动。
- 运行 npm run check、npm run build；提交前运行 npm run scope -- --role A --base origin/main（替换角色）。
- PR 写明功能、页面/接口、校验结果、模拟部分、是否改契约。有未完成项必须直说。
- 不安装新依赖、不改技术栈来绕过问题；需要依赖时向 D 提交变更请求。
- 冲突不能通过覆盖另一方代码或整文件选 ours/theirs 解决；展示冲突意图并协调归属。
