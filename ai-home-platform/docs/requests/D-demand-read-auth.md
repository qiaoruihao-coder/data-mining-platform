# D：需求列表与详情的身份隔离

- 状态：按复审确认的公开读取规则修订；#95 已合入，现有 #101 分支已同步 main。
- 集成基线：main dc5d8ef（含 #95 的当前业主创建需求及 #103 的本人报价页面）；普通合并同步并保留提交历史，保留受保护 POST，不强推已发布分支。同步后已重新运行 `npm run db:setup`，本地数据库结构与 seed 准备成功，未重置现有记录。
- 原因：GET /api/demand 与 GET /api/demand/[id] 原先无鉴权，列表返回全部账号的数据，详情仅按 ID 查询。

## 字段、权限及来源

继续使用公共 Demand、DemandIdParams、envelope(Demand / Demand[])，不增加字段、依赖或 schema。两个 GET 均不接受查询参数，包括 ownerId、providerId、role、status、分页等；非空路径 ID 原样精确查找，不 trim。

在一个 Serializable 事务中验证持久化会话、当前账号角色/绑定，再执行受限 SQL 并校验输出：

- 列表：有效业主可读本人所有状态的需求，SQL 按 ownerId 过滤；没有业主 cookie 时返回全部 published 需求（包括已发布 demo-demand），匿名也能访问，不要求演示服务方登录。
- 详情：published 对所有访问者可读；非 published 只允许所属业主读取。他人非公开需求与不存在的需求均返回完全相同的 404。列表与详情访问范围不同，登录业主的本人列表仍不混入他人公开需求。
- 两种 cookie 同时存在时业主优先；无效、重复、过期或撤销的业主 cookie 返回 401，列表与详情均不回退匿名或服务方。当前业主角色变更为其他角色返回 403。角色导航不改变授权。
- 没有业主 cookie 时，失效、重复、关闭的演示服务方凭证不妨碍读取公开需求；不能获得非公开需求。合法空列表返回 200，不能将故障伪装为空数组。
- 每条 Demand.source 保留数据库需求 live / 固定 demo-demand mock。普通匿名与业主查询整体含 demo-demand 时为 mock，否则 live（包括空列表）；仍然有效的演示服务方会话整体保持 mock。演示会话只影响来源标识，不是读取公开需求的前提。
- 所有成功/失败响应 private, no-store、Vary: Cookie。存储、会话读取、越界数据库返回或 DTO 验证异常统一 503/DATABASE_UNAVAILABLE，无内部错误泄漏。

## 调用方影响及界限

A 的本人列表通过业主登录获得所有本人状态；C 的大厅、管理页面与 B 匹配页面保持匿名读取 published 需求及详情，不要求演示服务方登录。URL 与 DTO 不变，匿名返回仍不包含 ownerId 等业主信息。鉴权错误交调用方显示，不能转为成功或 mock。D 不修改 A/B/C 私有页面；登录后自动刷新与身份提示由各负责人接入。

本次只保护两个需求 GET。供 B 内核复用的 findDemand/listDemands 不改签名；match、schedule 等其他接口仍需逐项审计，不能据此宣称全平台已隔离。历史 demo-owner 需求不转移；POST 沿用已合入 #95 的当前登录业主归属规则。

## 验收

隔离 SQLite 和合成账号覆盖两业主本人列表/所有状态、匿名公开列表与详情、跨业主 published 可读/非 published 404、无效业主 cookie 拒绝、服务方失效时仍可公开读取、双 cookie 优先级、精确 ID、未知参数、来源、空列表、存储与坏 DTO 失败。公开路由通过真实密码登录和退出验证；生产冒烟检查匿名列表与 demo-demand 详情 200、匿名创建 401/403。

同步 main dc5d8ef 后的实际结果：本地现有数据库及隔离冒烟数据库均重新执行 `npm run db:setup` 成功；`npm run check` 581/581（含 14 项需求读取测试）、`npm run build` 通过。`npm run scope -- --role D --base origin/main` 通过，共 9 个 D 文件；`git diff --check` 通过。在隔离 seed 数据库启动生产 `next start` 后，`node scripts/smoke.mjs` 的 13 个页面、12 个 GET 场景及 4 个 POST 场景全部通过；覆盖匿名列表/演示详情 200、失效业主凭证 401、匿名创建 401 和缺 Origin 403。测试只使用隔离临时数据库和合成账号；身份、查询及会话使用实际实现。冒烟使用 `AI_MODE=mock`，演示需求及服务方身份保持 mock 标识；生产服务方认证、管理员专属数据范围以及其他 API 的隔离未实现。
