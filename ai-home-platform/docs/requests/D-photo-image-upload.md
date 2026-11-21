# D：施工照片上传与受控引用

## 具体共享变更请求

回应 `A-photo-upload.md`：现有页面发送文件名，服务端没有照片可供分析。本次先交付实际上传、需求归属和引用有效性，AI 分析仍明确为 501；不改 A 页面。本分支已同步包含接单 PR #119 的 main，上传不依赖接单详情权限修复 PR #120。

新增 `sharp` 固定版本 0.35.5（Node >=20.9，与本项目 Node 要求兼容），用于 JPEG/PNG 实际解码、方向归一化及重编码移除 EXIF 等元数据。只检查 MIME/文件头不足以确认有效图片，此依赖直接服务于上传校验，不更换框架、数据库或 AI 技术栈。同步 package.json/package-lock.json，CI 验证 Windows 本地与 Linux 安装/构建。

## 协议与公共类型

- `POST /api/inspect/images`，同源 `multipart/form-data`；恰好一个文本 `demandId`，以及同名 `images` 的 1–10 个 File；不允许其他字段。客户端不要手写 Content-Type，让浏览器生成 boundary。
- 公共 `InspectionUploadFields` 校验非空且非纯空白的 demandId，保留原值精确匹配。`InspectionUploadResult` 为 `{demandId,images:[{imageRef,contentType,sizeBytes,width,height,expiresAt}]}`，字段和限制来自 src/contracts。
- 仅 JPEG/PNG，声明 MIME 必须与实际解码格式一致，拒绝动画、多页、SVG、空文件、坏图片和同批内容重复。每文件输入及标准化输出最多 2 MiB；整批文件/输出最多 10 MiB，含 multipart 的整个正文最多 11 MiB；单边最多 4096，像素最多 16,000,000。
- 原图不保存；按照 EXIF 方向旋转后重新编码为同格式 JPEG/PNG，移除元数据。JPEG 会重新压缩，不是原始文件归档；回执大小/尺寸对应保存后的内容。
- `imageRef` 形如 `inspect-image/<UUID>`，不含本地路径/文件名；引用有效 24 小时，expiresAt 为服务端 ISO 时间。首次成功 201/live，live 只表示实际保存标准化照片，不表示 AI 分析、验收或真实施工结论。

## 保存与权限

新增 Prisma `InspectionImage`（opaque id、ownerId、demandId、contentType、sizeBytes、width/height、SHA-256、bytes、expiresAt），二进制仅写本地 SQLite，不写 public/或仓库文件，不提供公开图片 URL。外键绑定当前业主及需求；删除需求会一并删除它的临时照片，不影响既有其他关联的删除约束。seed 不生成用户照片。

同源及业主会话预检后限长读取 multipart，第一次事务校验本人非演示 published/contracted/in_progress/completed 需求；解码在事务外执行；最终 Serializable 写事务重验同一会话、当前角色、归属和状态，再做配额检查和整批嵌套保存，最终 SQL 再限制当前归属/状态。输出在提交前验证，任何一步失败都不保存部分照片。draft 不支持上传。

每业主最多 50 张/50 MiB 有效照片，整个数据库最多 5000 张/500 MiB 记录；配额在同一写事务检查。进程同时最多处理 2 次上传，超出返回 429；单图原生处理设定 5 秒超时，不含等待工作线程的时间。无幂等键，重传产生新引用并计入配额，不推断网络失败时一定没保存。

过期引用立即不能使用；后续成功上传事务在最终授权通过后清理各业主 expiresAt <= 服务端 now 的过期行，再检查配额并保存，有效行保留；任何失败全部回滚。这样其他业主过期内容不会长期占住全局上传额度。没有后台定时清理，不保证到期时物理字节已被删除，SQLite 空闲页也不等于文件缩小；独立清理/保留管理接口与生产对象存储未交付。后续修复与验收见 `D-photo-expiry-quota.md`，下方保留上传首版测试记录。本文不声明生产级照片存储能力。

## /api/inspect 的行为

JSON 输入/输出契约字段不变，JSON 正文最多 32 KiB。先同源、会话和公共输入校验，再同一事务核验需求归属、每个引用的 ownerId/demandId/有效期及内容摘要。禁止把文件名、远程 URL 或其他人的引用当作照片，不下载客户端 URL。

无/失效/重复/撤销/过期业主凭证和仅服务方会话 401；跨源/当前角色不符 403；非本人/不存在需求统一 404，未知/过期/跨需求/跨业主引用统一 404 IMAGE_NOT_FOUND；演示需求只读及非法需求状态 409。坏字段/文件格式/正文或大小不合规 400；配额 409 IMAGE_QUOTA_EXCEEDED；暂时繁忙 429；存储/损坏记录/结果不确定 503 IMAGE_STORAGE_UNAVAILABLE。所有成功/失败 private, no-store、Vary: Cookie。

全部引用有效后仍返回 501 NOT_IMPLEMENTED，明确照片辅助分析尚未接通，没有 findings、meta 或验收成功。此状态不撤销已上传照片，也不更新排期/需求/付款。模型失败后回退 mock 的行为不存在。

## A 接线与验收

A 先上传 multipart，用 InspectionUploadResult 校验回执，再把返回的 imageRef 交给原 PhotoInspectionInput。不要继续把文件名作为引用，明确区分“照片保存成功”与“辅助分析未开放”，显示来源/过期时间。新 API 可直接 fetch FormData 并通过公共 envelope 校验；现有 apiPost 仅发 JSON，不适用于上传。

本次只交后端，A 上传表单接线、照片预览/删除管理、对象存储、真实模型分析和人工复核均未完成。部署先 npm ci，再 npm run db:setup，同步新表后重启；不 reset 数据库。

计划验收：真实解码/元数据移除、文件限制、匿名/跨业主/跨需求、会话及归属中途变化、过期/摘要损坏、配额和原子回滚；check/build/scope、实际生产 HTTP 冒烟及上传→有效引用仍 501 的链路。

## 实际验证（2026-11-14）

- `npm run check`：725/725，包含 lint、类型检查和模块边界；隔离 SQLite 验证真实 PNG/JPEG 解码、EXIF 方向及元数据移除、大小/字段限制、身份/归属中途变化、摘要损坏、配额并发、忙碌释放和失败回滚。
- `npm run build`、`npm run scope -- --role D --base origin/main`（16 文件）、`git diff --check` 通过。独立临时库 `npm run db:setup` 同步/seed 成功；未改日常开发库或 .env。Windows 初次同步遇到运行中测试占用 Prisma DLL，等待测试结束后串行重试通过。WORKFLOW 已补充测试数据库的显式环境变量及自动启停运行方式。
- 本机生产 HTTP 冒烟：13 页面、30 GET、原 13 POST + 新 6 照片鉴权 POST、3 PUT 通过；新增 `scripts/smoke-inspection-images.ts` 使用随机合成账号和生成图片，实际 HTTP 登录/创建需求/上传，验证持久化、旋转和去元数据、live 来源、有效引用 501、跨归属/过期拒绝、重复批次回滚及退出后 401，结束清理仅本脚本创建的账号/需求/照片。该链路随 CI 的 Production HTTP smoke 自动执行。
- 所有照片和账号均为合成测试数据，无用户照片写入仓库；测试中对故障/配额使用的注入仅存在于测试。运行时上传与存储为实际实现，没有 mock 上传回执或 AI 结果。

既有 A 页面仍须按上文两步协议接入；真实 AI 分析、照片管理/后台清理和生产对象存储未实现。
