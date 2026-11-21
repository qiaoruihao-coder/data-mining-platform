# D：LLM 网关最小实现

- 角色：D；状态：已实现，待 PR 合入。
- 文件：`src/lib/llm.ts`、`src/app/api/demand/chat/route.ts`、`tests/D-llm.test.ts`、`docs/API.md`、`.env.example`。
- 目标：为需求澄清提供服务端统一的 mock/live 来源、OpenAI 兼容 JSON 调用、超时、有限重试和 `ChatResult` 结构化校验。

## 行为

1. `AI_MODE` 不是 `live` 时返回固定的 `ChatResult`，API 信封标记 `meta.source: "mock"`。
2. `AI_MODE=live` 时只从服务端读取 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`，请求 `{baseUrl}/chat/completions`。
3. 模型响应必须提取 JSON 并通过 `src/contracts` 的 `ChatResult` 校验，成功才标记 `meta.source: "live"`。
4. 缺少配置、超时、可重试 HTTP 错误、非 JSON 或结构不合法在重试耗尽后统一返回 503 `AI_UNAVAILABLE`。
5. 客户端不会看到 API key；本次没有新增依赖，也没有改变 `ChatInput` / `ChatResult` 字段。

## 后续接入边界

- 真实认证、日志脱敏、模型供应商特有的多模态接口和费用统计仍未实现。
- 模型只能提供澄清文字和候选字段；金额计算、状态流转和数据库写入继续由服务端程序校验。
