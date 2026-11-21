# D：CI 自动运行生产冒烟

日期：2026-11-14。基于 main 0f1f0ea；#95、#101 已合入。排期读取 PR #104 尚未合入，不是本次任务的依赖。

## 原因与配置变更

现有 CI 只执行 check、角色范围检查及 build，构建成功无法证明实际 HTTP 页面/接口可用。此前鉴权变更没有同步冒烟脚本，缺陷直到人工启动生产服务才发现。本次把现有 `scripts/smoke.mjs` 接入每次 PR 和 main 的 CI。

- `.github/workflows/ci.yml` 在 build 成功后调用 `node scripts/run-production-smoke.mjs`；沿用现有 Node 22、Prisma seed 测试库及 AI_MODE=mock，不新增依赖、权限或外部服务。
- 启动器使用本地 Next CLI 的 `next start`，在 loopback 临时空闲端口启动刚构建的应用，健康检查就绪后才执行当前检出版本的 `scripts/smoke.mjs`。
- 启动和冒烟均有超时；启动退出、测试断言失败、超时或服务在测试中退出都必须失败。成功与失败均清理本次启动的服务及测试子进程，不停止其他开发服务。
- 强制 AI_MODE=mock，要求调用方明确提供 DATABASE_URL。CI 使用现有 `file:./ci.db`；本机验证使用单独临时数据库并先执行 db:setup，不使用个人业务数据库。
- 不改 scripts/smoke.mjs 的业务断言；执行当前检出版本，main 已包含 #95 的匿名创建拒绝断言和 #101 的公开读取断言。#104 的排期断言在该 PR 合入后会自然进入 CI，本次不提前引入。

## 验收

使用实际子进程验证正常结束、冒烟失败、启动退出、就绪超时、测试超时和服务意外退出，结束后服务不能仍监听端口。再使用隔离 seed 数据库运行 `npm run check`、`npm run build`、`npm run scope -- --role D --base origin/main`、`node scripts/run-production-smoke.mjs`，并检查 PR 远端 CI 包含生产冒烟步骤且成功。

## 本机复现

PowerShell 在仓库根目录执行，数据库路径应为专门的测试库，不要填写个人业务库：

```powershell
$env:DATABASE_URL = 'file:C:/Temp/ai-home-smoke/smoke.db'
$env:AI_MODE = 'mock'
npm.cmd run db:setup
npm.cmd run check
npm.cmd run build
node scripts/run-production-smoke.mjs
npm.cmd run scope -- --role D --base origin/main
```

macOS/Linux 设置对应绝对路径的 DATABASE_URL、AI_MODE 环境变量并使用 npm。启动器不读取 .env 来替代显式 DATABASE_URL，不替调用方构建或 seed。默认等待启动 30 秒、冒烟 90 秒，CI 步骤外层限时 3 分钟；失败保留子进程日志并以非零状态退出。SIGINT/SIGTERM 触发清理；先终止冒烟再终止服务，SIGTERM 后 2 秒仍未退出则 SIGKILL。Windows 直接终止，Linux 覆盖忽略 SIGTERM 的场景。

## 实际验证（2026-11-14）

- Windows / Node 26.0.0：使用临时目录内独立 SQLite 执行 `npm run db:setup` 成功；未改已有 .env 或提交数据库。
- `npm run check`：596/596 通过，包括新增 9 个生命周期测试；lint、类型检查、模块边界均通过。首轮类型检查发现测试环境 NODE_ENV 字面量被推断为 string，修正后重新完整通过。
- `npm run build`：成功；随后新启动器实际运行 `next start`，现有冒烟通过 13 个页面、12 个 GET 场景和 4 个 POST 场景，结束后服务停止。
- `npm run scope -- --role D --base origin/main`：4 个文件通过；业务冒烟断言、契约和依赖未修改。
- 新增测试使用合成 HTTP/CLI 进程验证启动器；真实 Next 的验证是上一项生产冒烟，不把测试夹具称为业务能力。CI 使用 Ubuntu / Node 22，远端结果以本 PR 的检查记录为准。

本次不改 DTO、API、schema、依赖、A/B/C 模块、docs/API.md 或 docs/tasks/D.md。固定演示数据和 AI 保持 mock；数据库读写使用本机/CI SQLite。生产认证、动态排期和其他业务待办不在此 PR 范围。
