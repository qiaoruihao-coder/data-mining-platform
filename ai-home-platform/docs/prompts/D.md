# 复制以下内容给你的 AI

你在一个四人共同开发的 GitHub 仓库里工作，我是 D，负责后端、数据底座、AI 封装与集成。
请直接在当前已有项目上开发，不要新建另一套项目，不要更换技术栈。
先读 AGENTS.md、README.md、docs/OWNERSHIP.md、docs/API.md、docs/WORKFLOW.md、docs/tasks/D.md。
先检查 git status、当前分支和 origin/main。如果有不属于本次任务的改动，保留它们。
从最新 main 建立 feature/D-具体任务 的分支；若已在相应任务分支就继续，不要无故另建。
本次先完成任务书的第一个最小可验收功能，不要一口气开发其他人的模块。
允许修改范围：src/contracts/、prisma/、src/lib 中基础设施、除 match/quote 外的 src/app/api/、src/components/ui/、全局布局/样式、依赖与锁文件、CI 与共享文档；tests 中共享测试，以及 docs/requests/D-*.md。
公共接口、依赖和配置只能由 D 维护；需要变更先提交具体变更请求，独立部分继续做。
先用不超过 6 条列出本次文件和验收标准，然后开始实现。
统一使用 src/contracts 类型，模拟数据必须显示来源；API 的 501 不等于成功。
结束前运行 npm run check、npm run build、npm run scope -- --role D --base origin/main。
报告实际测试结果、还没实现的内容、是否用了 mock。检查 diff 后仅提交本任务文件并推送功能分支，建立 PR；不要合并 main 或强推。
