# D：报价持久化来源决策

日期：2026-11-14。回复 `B-quote-demo-session.md`、`B-quote-read-api.md`。本次基线 main `2a2c1c4`。状态：D 已实现 schema、兼容契约、固定 mock、严格校验及汇总工具，并通过隔离旧库升级测试。B 的创建/重放/读取 DTO 与整体来源接线仍待完成；PR #79 合入前必须使用以下工具修正来源，不能仅凭本 PR 宣称读取误标问题已完全修复。

## 问题与决定

演示服务方能向 live 需求提交报价，当前 POST 已保守返回 mock，此前 Quote 表没有来源字段。只看需求来源的数据库读取内核会把这种报价误标 live。采纳 B 的建议：来源属于报价记录，必须在创建报价时由服务端持久化，不能根据之后的读取者、当前登录方式或需求来源猜测历史来源。

## 数据和公共契约

- D 已在 Prisma `Quote` 增加非空 `source String @default("mock")`；合法值复用 `src/contracts` 的 `Source`（mock/live），在写入和读取边界校验。SQLite String 本身不等于枚举校验。
- 现有记录全部回填 mock，包括 live 需求上的报价。没有可验证的历史生产身份依据，不能按 providerId、需求来源或是否已落库升级为 live。升级脚本/建表同步须先在含旧数据的隔离数据库验证，保留报价、回执和关联。
- 公共 `Quote` 已增加 `source: Source.optional()`，兼容旧 mock、客户端和历史 DTO；不复制 Quote 类型。字段缺失表示来源未知，不能按 live 展示。更新后的数据库适配器必须显式输出每条记录的 source；兼容性可选不代表可以省略持久化来源。
- `QuoteSubmissionInput` 继续严格拒绝 source、meta 和身份字段；新增字段仅为服务端输出。固定 mock 报价已补上 source: mock，现有 seed 在创建演示报价时一并保存该字段，仍不覆盖既有记录。
- `QuoteSubmissionReceipt` 不重复存 source，重放通过关联 Quote 读取原始来源，避免两个字段漂移。来源不属于客户端输入，不进入幂等输入摘要，也不改变现有键/摘要协议。

## 写入与重放

在同一事务中重新验证会话和账号绑定，由受信任的服务端认证适配器确定来源，再与报价及回执原子写入。当前演示认证始终写 mock；未来只有完成真实生产认证的适配器才能写 live。适配器缺少来源声明时保守使用 mock，不能用“不是固定演示账号”推断 live，更不能接收客户端声明。

首次提交的 DTO 和 `meta.source` 使用已持久化的报价来源；同键重放使用原 Quote.source，保留原 ID、金额和来源，不新增记录，也不因会话后来变为生产认证而升级历史 mock。重放仍须通过当前认证、账号绑定、需求存在和 published 等既有授权规则。接线完成前，当前公开处理器仍统一返回 mock。

## 读取及列表来源

每条返回报价携带自己的 source，列表 `meta.source` 同时考虑需求及本次实际返回的 submitted/accepted 报价：

| 需求来源 | 返回报价来源 | 整体来源 |
|---|---|---|
| live | 全部 live | live |
| live | 任一 mock 或兼容 DTO 来源缺失 | mock |
| mock 或未知 | 任意 | mock |
| live | 空列表 | live |
| mock 或未知 | 空列表 | mock |

空列表的 live 仅表示真实需求上的查询结果，不表示存在报价或已完成生产登录。授权和数据隔离规则不因来源变化而放宽。库中非法/空来源值属于数据损坏：显式 GET 返回 503，不把损坏隐藏成 mock、空数组或部分成功；POST 重放坏记录沿用现有内部错误规则。

`GET /api/provider` 的资料来源仍独立标识。报价 live 不意味着服务方资料真实；混合列表应保留逐条来源，不能把整个列表的 mock 解释为每一条都未保存。

## 实施归属和验收

1. D 已交付 schema、兼容契约、固定 mock、来源校验/聚合基础设施及历史回填测试；数据库同步步骤见下文，本次没有更改开发数据库。
2. B 在自己的报价事务、重放和读取适配中使用 D 的公共契约及基础设施；创建时写来源，查询时校验并输出来源。公开数据库 GET 必须等待这一步完成，不能仅把当前需求来源直接作为列表来源。
3. B/C 在各自页面正确展示逐条及整体来源；演示回执可表述“演示身份报价已保存，不代表真实业务身份或业主已收到”。D 不改写 B/C 私有目录。
4. 联调覆盖：live 需求上的演示报价写入/重连仍 mock；全 live、混合、空列表；历史回填不丢关联；伪造客户端 source 被拒绝；同键重放不升级来源；非法库值不成功；既有事务回滚和跨业主隔离不回退。

## B 的服务端接入入口

从既有允许的 `@/lib/quote-policy` 导入下列函数，类型继续使用 `@/contracts`；没有放宽目录边界或修改 B 私有文件。

```ts
import { parseStoredQuoteSource, summarizeQuoteSources } from "@/lib/quote-policy";

// 创建：当前仅开放演示认证，来源为服务端常量 mock，不能取请求体。
// 在 B 现有事务的 tx.quote.create({ data: { ...业务字段, source } }) 中使用。
const source = parseStoredQuoteSource("mock");

// 数据库映射（包括首次回执、幂等重放、GET）：
// Quote.parse({ ...现有 DTO 字段, source: parseStoredQuoteSource(row.source) })

// GET 完成授权及状态过滤、映射为 QuoteDTO[] 后：
// meta: { source: summarizeQuoteSources(demand.source, returnedQuotes) }
```

- `parseStoredQuoteSource(value: unknown): SourceDTO`：只接受 mock/live；undefined、null、空串和其他值均抛 ZodError，禁止缺省为 mock 掩盖坏库。创建时它只校验值，不验证身份；必须先完成原有事务认证，不能把请求体交给它作为来源证据。
- `summarizeQuoteSources(demandSource: DemandDTO["source"], quotes: readonly Pick<QuoteDTO, "source">[]): SourceDTO`：需求和全部返回报价均 live 时返回 live，否则保守 mock；空列表沿用需求来源，缺省需求为 mock。只读取来源，不修改列表；先校验全部来源，前面的 mock 不会遮蔽后面的非法值。兼容 DTO 的 undefined 可以汇总为 mock，但数据库行必须先经过严格校验。
- 汇总工具不授予访问权限、不负责挑选报价状态；传入 B 已授权、过滤并准备返回的同一列表。数据库 GET 的校验异常继续映射 503；POST 创建/重放坏输出沿用已有 500 内部错误规则。
- 首次和重放的响应 meta 使用对应持久化报价来源。未来生产认证接入前，当前公开 POST 保持 mock；不要根据 userId/providerId 或当前读取者推断历史来源。

## 旧库同步与回填

沿用本仓库现有 Prisma `db push` 流程，不另建一套 migration 历史。先停止本地应用并为现有 SQLite 文件留存备份，再在已配置 DATABASE_URL 的仓库运行：

```powershell
npm.cmd run db:generate
npm.cmd run db:push
npm.cmd run db:seed
```

也可使用已有 `npm.cmd run db:setup` 顺序执行三步。新增非空列的默认值会将原来无 source 的所有历史行填为 mock，不按需求/服务方身份猜测 live。无需 reset、force-reset 或 accept-data-loss；如出现数据丢失提示，应停止同步并核对 schema 差异。再次运行不会把已经显式保存的 live 重置为 mock；seed 也不覆盖已有报价。这些命令必须在部署新代码前对目标数据库执行，否则 Prisma 查询会因缺列失败。

`tests/D-quote-source.test.ts` 在临时目录先创建真实的无 source 旧表及报价/回执，再执行普通 db push；逐字段核对旧内容、回执、外键和 mock 回填。另验证默认新记录、明确 live 的重复同步保留、重复 seed、数据库重连、真实演示 cookie 提交/重放、客户端伪造来源拒绝及非法库值严格报错。所有账号和需求均为合成夹具，明确 live 的夹具仅测试存储，不代表已交付生产认证。

本轮实际验证：`npm run check` 450/450 测试通过，lint 无警告、类型和导入边界通过；`npm run build` 通过；`npm run scope -- --role D --base origin/main` 通过（11 个 D 文件）。生成了本地 Prisma Client，但未对开发数据库执行同步；升级与写入测试仅使用隔离 SQLite。

本次不开放真实业主登录、需求 PUT/DELETE 鉴权或 B 的数据库 GET；对应待办继续保留在 `docs/tasks/D.md`。
