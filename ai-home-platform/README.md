# AI 家装履约撮合平台
四人 / 28 小时 / Web。按团队提供的 [总方案](方案参考.md) 搭建。
目标链路：需求澄清 → 服务方匹配 → 报价透明 → 施工排期 → 评价/售后。
**当前为比赛开发版本，不是完整产品。部分业务写入及业主鉴权已实现，服务方资料和 AI 澄清仍默认使用模拟数据；各接口的实际状态见 docs/API.md。**

## 已知限制

- **AI 澄清默认是 mock**。仓库不包含供应商凭据；配置服务端 `AI_MODE=live` 和 `LLM_*` 后可调用真实模型。2026-11-15 已在本机生产构建验证完整草稿、缺失预算、补充与纠正四种真实调用，以及浏览器草稿展示；非法 JSON、超时和 503 通过受控测试验证。CI 冒烟仍明确使用 mock，不依赖付费模型。其他部署须自行配置并验收，失败不降级成模拟成功，详见 [真实澄清验收记录](docs/requests/D-demand-chat-live.md)。
- 固定演示档期覆盖 **2026-11-15 至 2026-12-31**；答辩若晚于 2026-12-31，须提前由 D 更新样例并与 B/C 复核过期判断和 mock 标识。演示窗口不是预约或施工承诺。
- `/api/match` 已随 #161 接入 #160 的受控读取器：published 可公开匹配，其他状态仅所属业主可读，匿名和他人统一 404；显式失效业主凭证不回退匿名。D 的共享生产冒烟验证正常接受报价后的非公开需求访问。该接口已隔离不代表整个平台完成权限审计，规则见 [匹配读取交接](docs/requests/D-match-read-access.md)。
- #165 固定 B 测试夹具后，D 已将 a/b 基础分统一为 98，并互换固定档期。在仅含种子评价的隔离库、上海日期 2026-11-15 至 2026-11-21 内，固定演示页 live→mock→live 为 b→a、a→b、b→a；11-22 起 b 剩余不足 30 天，live 回到 a→b。实际浏览器结果见 [演示联验记录](docs/requests/D-demo-browser-validation.md)。
- 照片上传为 live，照片检查仍是明确 mock，live 分析返回 501；生产服务方/管理员认证、真实付款、专业验收及售后解决未完成。模拟付款只保存在服务进程内，重启会重置；角色导航不是权限。

完整操作顺序、隔离库准备、当前演示预期与失败处理见 [演示操作脚本](docs/DEMO.md)。当前已完成与待办以 [D 任务清单](docs/tasks/D.md) 和 [交付状态](docs/STATUS.md) 为准。

## 每位成员从这里开始
1. 每人 clone 自己的一份仓库；不要共用同一个工作目录。
2. 指定 A/B/C/D 角色，把下面对应提示词整段交给 AI。
3. AI 先读根目录 AGENTS.md，再读自己的任务书。
4. 基于最新 main 建 feature/角色-任务 分支，小功能完成就提 PR，D 负责集成。

| 角色 | 按原方案负责 | 开工提示词 | 任务书 |
|---|---|---|---|
| A | 业主端、需求澄清 UI、进度和付款展示 | [复制 A 提示词](docs/prompts/A.md) | [A 的任务](docs/tasks/A.md) |
| B | 匹配、报价页面、接口与逻辑 | [复制 B 提示词](docs/prompts/B.md) | [B 的任务](docs/tasks/B.md) |
| C | 服务方端、管理端、售后 UI | [复制 C 提示词](docs/prompts/C.md) | [C 的任务](docs/tasks/C.md) |
| D | 数据库、后端基础、AI 封装、公共契约与集成 | [复制 D 提示词](docs/prompts/D.md) | [D 的任务](docs/tasks/D.md) |

**建仓库和分目录不能消除接口问题。** 本仓库用共同契约、固定 mock、独立分支和 CI 检查减少冲突；仍由人确认业务接口与合并结果。

## 首次启动
推荐所有人统一 Node.js 22 LTS，使用同一 package-lock.json。
PowerShell（Windows）：
```powershell
git clone https://github.com/LZX-PQZ/ai-home-platform.git
cd ai-home-platform
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run db:setup
npm.cmd run dev
```
macOS / Linux：使用 npm 而非 npm.cmd，使用 cp .env.example .env。
访问 http://localhost:3000 。无 API key 也能启动。不要覆盖已有 .env。
数据库仅本机使用，默认 prisma/dev.db，不提交、不跨成员同步。

已有项目拉取包含 PR #81 的 main 后，也需要运行一次 `npm run db:setup`（PowerShell 使用 `npm.cmd run db:setup`），再重启应用。该变更新增 `Quote.source`；同步会保留已有记录，将历史报价来源保守回填为 `mock`，重复 seed 不覆盖现有记录。未同步的旧库查询报价可能因缺少该列而失败。使用现有 `.env` 即可，无需重新复制或重置数据库。

照片上传后端新增 `sharp` 依赖与 `InspectionImage` 表，首次更新到包含该功能的分支后运行 `npm ci`、`npm run db:setup` 并重启（PowerShell 使用 `npm.cmd`）。上传入口 `POST /api/inspect/images` 仅接受当前业主本人需求的 JPEG/PNG，保存标准化内容并返回 24 小时有效的引用。A 的上传页面 #134 已接线；照片保存为 live，随后 `/api/inspect` 在 `AI_MODE=mock`（未设置也默认 mock）返回明确标注“未分析照片内容”的模拟提示，`live` 模式真实分析仍为 501，不降级为 mock。页面分别展示两次请求来源，模拟提示不代表实际缺陷或验收结论。本次检查结果无需新增依赖/表。照片仅存本地 SQLite，没有公开图片 URL；到期立即停止引用，后续成功上传在同一事务清理各业主过期记录、检查全局配额，有效照片保留，失败整笔回滚。无后台定时清理，SQLite 文件不保证立即缩小。详见 [模拟检查交接](docs/requests/D-photo-inspection-mock.md)、[上传交接](docs/requests/D-photo-image-upload.md)与[过期配额修复](docs/requests/D-photo-expiry-quota.md)。

评价后端已提供 `POST /api/review` 和 `GET /api/review?demandId=…`，更新后运行 `npm.cmd run db:setup` 同步评价接单关联与来源列，再重启；历史评价保留，不自动补造成真实接单评价。仅所属业主可对需求与接单均已完成的实际关系提交一次评价，来源沿用接单，mock 不升级。详见 [评价交接](docs/requests/D-review-create.md)。

服务方公开目录新增评价汇总：`GET /api/provider?performanceSource=live|mock`，缺省 live。返回已完成接单的业主评价均分、样本数和计算时间，mock/live 分开；没有所选来源样本时返回 null/0，不用种子评分补齐。六个演示服务方基础资料和固定档期样例仍明确为 mock，整体来源仍 mock，每条评价汇总保留自己的来源。档期窗口只用于演示资料，不代表预约或施工承诺；只公开统计和档期字段，不公开评论或业主/接单编号。**已知限制：任一查询范围内的坏评价/关联或存储错误会使整个目录返回 503**，影响 C 需求页和 B 匹配页；B 报价页保留报价，服务方名称与来源待确认。B 的档期/评价排序 #153、C 的档期展示 #152 已合入；2026-11-15 已完成隔离库浏览器联验，发现的 A 履约确认按钮问题已随 #168 合入修复，详见 [浏览器记录](docs/requests/D-demo-browser-validation.md)。字段见 [汇总交接](docs/requests/D-provider-performance.md) 和 [档期与演示数据交接](docs/requests/D-provider-availability.md)。

本轮固定演示验收（不需要新增依赖或 schema）：

1. 如需核对数据库中的完整新样例，按下方命令使用**全新隔离数据库**。已有库运行 `npm.cmd run db:seed` 只补缺失记录，**不会覆盖 quote-a/quote-b 等既有演示报价**，所以库中旧报价不会因此出现新的单位/列项提醒；原账号也保留，不为 demo-owner 设置密码。
2. 打开 `/owner/quotes/demo-demand`：这个固定公开报价页直接使用当前代码样例，不读取数据库内的同 ID 报价，更新代码并重启即可核对提醒。同名“防滑地面”分别按平方米/项报价；“成品保护”只在 quote-b 单独列明，触发列项差异；quote-a 的“垃圾清运”仍待确认。已知小计仍为 ¥12,000.00 / ¥13,000.00，全部标 mock，不代表最终总价。其他受保护报价仍按实际业主归属读取数据库。
3. 打开 `/api/provider?performanceSource=mock`：在仅含种子样本的数据库中，provider-a 的评价均分为 4.67、样本 3，provider-b 为 4、样本 1；来自四条明确 mock 的合成已完成接单/评价。已有其他 mock 样本时按全部有效样本重新汇总。无 live 评价时，`/api/provider` 仍返回 live 的 null/0。
4. 同一目录返回固定档期：provider-a 为 2026-11-18 至 11-30、12-05 至 12-20 两段 13/16 天窗口，provider-b 为 11-20 至 12-20 的 31 天连续窗口；另含空窗口与未知样例。覆盖 2026-11-15 至 2026-12-31，过期不再使用档期细排。双方基础分均 98；在上述新库中，上海日期不晚于 11-21 时 b 的剩余连续窗口可容纳 30 天需求，live 为 b→a；手选 mock 后评价优先，变为 a→b，切回 live 恢复 b→a。11-22 起 live 回到编号顺序 a→b；不得改时钟或静默延长样例。

数据库演示准备：先停止本工作目录已有的 dev 服务，避免多个进程同时写 `.next`，再单独打开 PowerShell 终端。每次生成新库名，保留原库及 `.env`：

```powershell
$env:DATABASE_URL = "file:./demo-$([guid]::NewGuid().ToString('N')).db"
$env:AI_MODE = "mock"
$env:DEMO_AUTH_ENABLED = "true"
npm.cmd run db:setup
if ($LASTEXITCODE -ne 0) { throw "演示数据库准备失败，请先检查错误" }
npm.cmd run dev
```

演示结束按 Ctrl+C 停止本次服务并关闭该终端，正常启动仍使用原 `.env`。不要删除或重置已有数据库来更新样例。受保护报价的演示应在同一隔离库环境下运行 `npm.cmd run owner:create`，登录新账号、创建本人需求，再由演示服务方提交报价；seed 中的 demo-owner 不能直接登录。

履约后端新增 `POST /api/order/progress`，业主明确确认后，需求与接单在同一事务中“已签约→施工中→已完成”。有排期时按依赖逐项开工/确认完成，保留历史版本，全部完成才允许整单完成；无排期也须显式确认。运行 `npm.cmd run db:setup` 同步操作记录表后重启。生产 HTTP 冒烟已通过正常接口推进到评价，不再直接改库伪造完工。专业验收、返工/阻塞和付款联动未实现。详见 [履约交接](docs/requests/D-order-progress.md)。

履约操作记录已提供 `GET /api/order/progress?demandId=…`，仅登录业主可读取本人需求的已保存动作、状态变化、工序/排期版本和记录时间，隐藏操作者身份。来源沿用接单，mock 不升级；历史接单没有记录时不补造，损坏数据与权限失败也不伪装空列表。A 的履约按钮已随 #144 接线，操作记录展示已随 #162 接入非演示需求的最新施工排期页，可刷新并核对逐条来源。已有操作记录表无需再改 schema 或依赖，详见 [操作记录交接](docs/requests/D-order-progress-history.md)。

## 接单数据同步

接受报价与接单后端已提供 `POST /api/order` 和 `GET /api/provider/orders`，部署本功能前运行 `npm.cmd run db:setup` 同步新增的 ServiceOrder 表，然后重启应用；不要重置数据库。既有需求、报价及提交回执保留，历史 accepted 报价不自动补成接单。B 的接受按钮与 C 的实际接单页面已随 #121/#122/#125 合入，A 的履约动作按钮已随 #144 接线；履约操作记录展示已随 #162 接入。本版一需求只能接受一份报价，含待定费用的报价不会被宣称已确认最终总价。演示报价建立的关系仍标 mock，不代表生产服务方认证、付款或履约完成。协议见 [接受报价交接](docs/requests/D-quote-acceptance.md)。

业主接单读取已提供 `GET /api/order?demandId=…`：仅所属业主可取 OrderSummary（含履约用 id、评价用 providerId），无接单返回 null；不再需要重放接受报价来获取编号。来源沿用接单，异常不伪装空态。A 接线见 [业主接单读取](docs/requests/D-owner-order-read.md)。本次无数据库或依赖变更。

## 演示服务方登录

在已有 `.env` 中设置 `DEMO_AUTH_ENABLED="true"`，运行 `npm.cmd run db:setup` 同步会话表与演示账号，再重启应用。点击顶栏右上角的登录状态按钮（未登录时显示“未登录”），在浮层中点击“演示服务方登录”，即可使用固定的 `provider-a` 演示身份；无需填写或提交真实账号密码。默认关闭，界面和接口均明确标记模拟来源。

会话有效期 30 分钟，刷新后可读取，点击“退出演示登录”会撤销会话。上方角色切换只切换导航。报价 POST 已接入预检及事务内演示会话读取：同源有效 cookie 对非演示、已发布数据库需求的合法首次提交返回 201，同键同内容且当前授权有效的重放返回 200；报价及幂等回执实际落库，两种回执均标记 `meta.source: mock`。匿名、过期或退出后的请求仍返回 401。mock 表示演示身份，不代表生产认证或业主已收到报价；演示需求仍只读。接口和接入步骤见 [演示会话交接](docs/requests/D-demo-provider-session.md)。

## 业主账号登录

拉取本功能后先运行 `npm.cmd run db:setup` 同步密码凭证及限频表，再由维护者在本机交互终端运行 `npm.cmd run owner:create`（macOS/Linux 用 `npm`）。按提示输入登录账号、显示名称和两次密码；密码需 15–128 字符，终端不回显，不能通过命令参数或管道传入。该命令只创建新业主，不给 `demo-owner` 设置密码，也不覆盖已有账号；没有默认密码或公开注册接口。

启动应用后，点击顶栏右上角的登录状态按钮，在浮层中点击“业主登录”。密码验证通过后可刷新保留会话，30 分钟到期需重新登录；“退出业主登录”会撤销当前会话。使用 HTTPS 或本地 `http://localhost:3000` / `http://127.0.0.1:3000`，普通局域网 HTTP 地址会被拒绝；cookie 始终保留 Secure、HttpOnly 和 SameSite=Strict。每账号 15 分钟最多 5 次认证失败，第六次起限流；成功不计入且清空该账号失败历史，已移除全局账号锁定。超限或密码计算繁忙时按 Retry-After 稍后重试。账号认证成功标 `live`，表示实际验证了密码，不代表实名认证。

当前登录业主可创建本人需求，并修改或删除本人可编辑且满足约束的需求。新账号不会自动取得历史 `demo-owner` 需求的归属。匿名需求列表只含已发布需求（包括已发布的 `demo-demand`），不要求演示服务方登录；业主登录后列表返回本人所有状态。已发布详情公开，非公开详情可由所属业主或持有效会话且有本人实际接单关系的服务方读取；失效业主 cookie 返回 401，双 cookie 仍业主优先。服务方列表仍只含已发布需求。页面登录后可刷新/重试，角色切换不改变授权。详见 [需求读取权限](docs/requests/D-demand-read-auth.md)及[接单详情权限](docs/requests/D-provider-demand-access.md)。

B 的报价 API 和页面仍校验业主归属：演示流程请使用 `npm run owner:create` 开通账号，登录后新建需求，再用演示服务方提交报价，最后以原业主身份打开该需求的报价页。固定 `demo-demand` 没有可登录业主，公开需求详情不代表可读取其受保护报价。本次没有交付公开注册、找回密码、MFA 或第三方登录。详细协议见 [业主登录交接](docs/requests/D-owner-login.md)。

## 开工与验收
```bash
git switch main
git pull --ff-only origin main
git switch -c feature/A-demand-chat
npm run check
npm run build
npm run scope -- --role A --base origin/main
```
Windows 如遇 npm.ps1 执行策略限制，使用 npm.cmd，无需修改系统策略。
运行 dev 和 build 时使用不同时间段，避免同时写 .next。

## 文档入口
- [演示操作、预期与失败处理](docs/DEMO.md)
- [分工与目录归属](docs/OWNERSHIP.md)
- [接口契约与当前实现状态](docs/API.md)
- [Git/AI 协作流程](docs/WORKFLOW.md)
- [28 小时排期与验收](docs/PLAN.md)
- [GitHub 发布及权限设置](docs/GITHUB.md)
- [当前实现与待开发清单](docs/STATUS.md)
- [共享文件变更请求模板](docs/requests/TEMPLATE.md)

## 技术与约束
遵循参考方案：Next.js 14 / React 18 / TypeScript / Tailwind / Prisma / SQLite。
版本和 lockfile 已固定。此版本线用于按方案快速协作；公开部署前需 D 检查维护状态、依赖安全并规划升级。
金额用分，未知费用用 null；模拟来源显式展示。禁止把模拟付款称为真实资金托管。
当前角色导航不是访问控制；本骨架只用于本地/比赛开发，不直接用来承载真实客户数据。
全局视觉 token 位于 `tailwind.config.ts`，共享组件从 `@/components/ui` 引入；页面优先使用 `brand`、`accent`、`ink`、`line`、`canvas` 等语义类名，避免各模块重新定义颜色和尺寸。
本模板不绑定特定 AI 工具；如果工具不自动读 AGENTS.md，必须在开工提示中明确要求读取。
