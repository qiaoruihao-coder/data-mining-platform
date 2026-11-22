# 三角色正常登录与独立演示（2026-11-22）

用户已确认保留原账号和业务库，并新增三角色免密演示。新增 `/api/auth/experience` 和顶部模式入口；不改正常账号密码认证。正常部署默认关闭免密端点。

部署演示实例需要 `ISOLATED_DEMO=true`、绝对 `DATABASE_URL=file:.../isolated-role-demo.db`，并先运行 `scripts/prepare-isolated-demo.ts`。脚本拒绝已有非演示标记库及含密码账号的库。请求在事务内复核标记、无密码凭据及固定角色绑定。输入严格限制为 role，不接受账号ID。切换角色撤销此前浏览器三个角色的会话并清理旧Cookie。

正常与演示实例使用不同HTTPS域名和数据库；保持Secure/HttpOnly/SameSite及原密码验证。根布局显示模式及可选跨实例链接，使用服务端 `NORMAL_APP_URL` / `DEMO_APP_URL`，仅接受HTTPS。演示实例所有业务均为模拟，不能把落库成功理解为真实成交。

运营布局读取会话的内部地址须通过 `INTERNAL_APP_URL` 指向该实例，不能沿用默认3100端口。此项通过部署配置修复，无需修改C模块。

计划：隔离SQLite测试 → 专用演示种子 → 类型/构建/相关回归 → 两实例HTTPS与HTTP会话验收 → 手机验证 → 更新README与二维码。
