# 四人用 AI 的工作流程
每人自己 clone，一人一个角色。不要在四台机器各生成一个新项目；不要把文件压缩包互相覆盖。

## 第一次演练
1. 启动成功。
2. 从 main 建 feature/角色-hello。
3. 只在 docs/tasks/自己角色.md 增加一条本机启动结果。
4. 跑检查、提交、push、开 PR，由 D 合并。
5. 四个人都完成演练后，再做功能。

## 开始新任务（以 A 为例）
先确保 git status 没有未处理改动；有改动就先保存到当前功能分支。
```bash
git switch main
git pull --ff-only origin main
git switch -c feature/A-demand-chat
```
不要直接在 main 写代码。每个小功能用一个短期分支，避免持有 28 小时的大分支。

## 开发中的同步
```bash
git fetch origin
git merge origin/main
```
出现冲突先检查归属；不要 reset --hard、强推或整文件覆盖。合并前保存当前改动。
同步后重跑受影响的检查。

## 提交与 PR
```bash
npm run check
npm run build
npm run scope -- --role A --base origin/main
```
另开终端运行 `npm run start` 启动刚构建的生产服务，再在原终端执行：
```bash
node scripts/smoke.mjs
```
照片冒烟会创建随机合成业主和图片，经实际 HTTP 上传验证后清理本次创建的数据。服务端和冒烟进程必须显式使用同一个已同步 seed 的隔离测试数据库 `DATABASE_URL`；仅配置工作树 `.env` 不能替代冒烟进程的环境变量。不要把冒烟地址指向远端服务。

履约/评价冒烟创建并清理随机合成账号，经实际 HTTP 登录、演示服务方报价、接受报价、创建排期、开工/工序完成/整单完成、提交和读取评价，同时检查服务方接单列表和详情状态。不会直接改库伪造 completed；仅 live 来源的报价仍为存储夹具，因为生产服务方认证尚未实现。分别验证 mock/live 不变、未完成/跨归属/旧版本/跳级/坏数据/退出拒绝。不能在真实用户数据库上运行这些夹具。

同一冒烟还读取公开服务方评价汇总：默认 live、显式 mock/live 分离、同内容重放只计一次、坏来源 503、目录不扩大、无评论或关联 ID。live 来源报价仍仅为合成存储夹具；基础服务方目录与演示认证保持 mock。

runner 只对本次服务和冒烟子进程设置 `DEMO_AUTH_ENABLED=true` 与 `AI_MODE=mock`，不修改 .env 或正常启动配置。直接运行 smoke.mjs 时需给测试服务及冒烟进程均显式开启该演示开关；固定 demo-demand 仍只读，写链路使用新建的合成业主需求。

也可让 runner 自动启动并停止独立端口的生产服务。PowerShell 在同一终端设置 `$env:DATABASE_URL = "file:./smoke.db"`、`$env:AI_MODE = "mock"`，然后依次运行 `npm.cmd run db:setup`、`npm.cmd run build`、`node scripts/run-production-smoke.mjs`。macOS/Linux 先 `export DATABASE_URL="file:./smoke.db" AI_MODE=mock`，再使用 `npm` 执行相同命令。使用专门测试库，保留已有 `.env`。

默认服务地址为 `http://127.0.0.1:3000`，可用 `SMOKE_BASE_URL` 指定。冒烟使用已同步 seed 的本地测试数据库及 `AI_MODE=mock`；匿名创建需求应返回 401/403，不能断言匿名写入成功。完成后停止本次启动的服务；dev 和 build 不得同时写 `.next`。鉴权或接口变更须同步更新冒烟断言，并实际在生产服务上运行。

检查通过后提交：
```bash
git status --short
git add 本次明确修改的文件
git commit -m "feat(owner): 完成需求澄清页面"
git push -u origin feature/A-demand-chat
```
GitHub 页面点 Compare & pull request，base 选 main。
提交前检查 diff；不要用 git add . 把密钥或无关改动混进去。
D 审阅 PR 的行为、接口兼容性与演示效果，CI 通过后合并；不要只看 AI 说“已完成”。

## AI 每次结束应交付
- 改了哪些文件、分别解决什么问题。
- 如何打开和验收；命令是否实际通过。
- 当前使用真实模型还是 mock，哪些功能尚未完成。
- 是否需要其他角色变更契约，是否存在越界文件。
- 提交/PR 链接，或明确尚未提交。

## 检查机制的限度
scope 检查角色与文件归属；boundaries 检查静态及字符串动态导入。它们不是权限隔离，也不能证明业务正确。
CI 失败不会自动阻止合并，除非仓库规则明确要求 CI 通过。
CODEOWNERS 尚未填真实用户名，不会自动分配审阅者；由 D 在成员加入后完善。
若其他 AI 不会自动读 AGENTS.md，把提示词中的读文件要求保留，不要只说“帮我完成 A”。
