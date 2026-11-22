# 原账号自动登录

已按维护者授权开放公网原账号免密访问。访问业主、服务方、平台运营页面时，分别登录服务端配置的原账号。入口顶部说明公开访问权限。角色切换清除其他角色的浏览器 Cookie。新会话签发后重新加载页面，使服务端和浏览器读取同一身份。

配置默认关闭。仅在 PUBLIC_ACCOUNT_ACCESS=true 且 ISOLATED_DEMO 不为 true 时生效，原独立演示入口不变。必须明确设置 PUBLIC_OWNER_ID、PUBLIC_PROVIDER_ID、PUBLIC_ADMIN_ID 和指向原库的 DATABASE_URL。服务端验证已有账号及角色，拒绝客户端提交任意账号 ID、跨站请求和公网 HTTP。

使用现有数据库启动，禁止初始化、seed、重建或迁移原库。构建后在配置好这些环境变量的终端运行：

```sh
node scripts/start-public-access.mjs
```

本次原库备份位于 C:/Users/PC/platform-backups/before-public-auto-login.db。未将数据库或凭据提交仓库。

验证结果：类型检查和生产构建通过。显式测试数据库运行 D-public-account-access.test.ts 通过，覆盖关闭入口、跨站、非法身份参数、缺失账号、三个角色会话、有效会话复用和业务数据不变。该测试需 PUBLIC_ACCESS_TEST_DATABASE_URL 指向名为 public-access-test.db 的备份副本；未提供时跳过，避免访问原库。

真实 HTTPS Edge 浏览器使用全新上下文验证三个角色自动登录、业主需求和服务方订单读取、运营页面访问，无页面脚本错误。原账号 roadshow-owner 关联31条需求；原库总计36条需求、47份报价、16条已完成服务订单，当前服务方关联15条订单。账号、凭据、需求、报价、订单、履约事件、排期、付款、评价及工单逐行与上线前备份一致。历史订单中含合成演示记录，不代表真实交易。

公网原入口仍为 https://styles-advanced-photo-carmen.trycloudflare.com 。这是临时隧道，依赖电脑、服务和隧道保持运行。源码通过 feature/D-original-auto-login 分支提交并同步至仓库。全量历史测试未重新宣称通过。
