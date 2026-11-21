# GitHub 管理
目标仓库：LZX-PQZ/ai-home-platform，private。

2026-11-13 已创建并上传。GitHub 拒绝为当前私有仓库开启分支保护（HTTP 403，提示需要 Pro 或公开仓库）。仓库保持私有，未购买升级。CI 会运行，但失败不会强制阻止合并；现阶段由 D 审阅并统一合并。

## 管理员后续配置
1. Settings → Collaborators 邀请其余三位成员；他们接受后才有私有仓库访问权限。
2. 四人约定谁是 A/B/C/D，按 docs/OWNERSHIP.md 填 .github/CODEOWNERS 的真实 @用户名，保证用户有 write 权限。
3. 如 GitHub 账号方案支持私有仓库规则，给 main 配置必须 PR、至少 1 人审阅、CI check 必须通过、禁止 force push。
4. 如果方案不支持上述规则，采用 D 统一合并的团队约定；不能声称已有强制保护。
5. 当前目录检查用于减少误改，不是安全权限边界。

## 命令行发布（仅管理员）
```bash
gh auth login --scopes workflow
gh repo create ai-home-platform --private --source=. --remote=origin --push
```
如果仓库已经创建，不要重复创建，先检查 git remote -v。
没有用户名/提交邮箱时，先在本仓库配置身份，不改全局配置。
