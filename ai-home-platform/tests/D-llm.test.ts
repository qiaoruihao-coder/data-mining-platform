import test from "node:test";
import assert from "node:assert/strict";
import { ChatInput, ChatResult } from "../src/contracts";
import { POST } from "../src/app/api/demand/chat/route";
import { callLlmJson, clarifyDemand, LlmUnavailableError } from "../src/lib/llm";

const input = ChatInput.parse({ messages: [{ role: "user", content: "我想改造深圳的老人房" }] });
const envKeys = ["AI_MODE", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_TIMEOUT_MS", "LLM_MAX_RETRIES"] as const;
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

function restoreEnv() {
  for (const key of envKeys) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.afterEach(restoreEnv);

test("mock 模式返回 ChatResult 并标记 mock 来源", async () => {
  process.env.AI_MODE = "mock";
  const result = await clarifyDemand(input);
  assert.equal(result.source, "mock");
  assert.equal(result.data.ready, false);
  assert.ok(result.data.missingFields.includes("city"));
});

test("需求澄清 API 使用实际来源信封", async () => {
  process.env.AI_MODE = "mock";
  const response = await POST(new Request("http://localhost/api/demand/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).meta, { source: "mock" });
});

test("live 模式缺少配置时返回不可用，不调用外部服务", async () => {
  process.env.AI_MODE = "live";
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  const response = await POST(new Request("http://localhost/api/demand/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).error.code, "AI_UNAVAILABLE");
});

test("live 模式只接受经过契约校验的 JSON，并标记 live 来源", async (t) => {
  process.env.AI_MODE = "live";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://llm.example/v1";
  process.env.LLM_MODEL = "test-model";
  const calls: Array<{ url: string; body: string }> = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: "请补充面积", ready: false, draft: null, missingFields: ["areaM2"] }) } }] });
  });

  const result = await clarifyDemand(input);
  assert.equal(result.source, "live");
  assert.equal(result.data.reply, "请补充面积");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
  assert.match(calls[0].body, /test-model/);
  const prompt = JSON.parse(calls[0].body).messages[0].content;
  for (const field of ["reply", "ready", "draft", "missingFields", "description", "city", "areaM2", "budgetMinCents", "budgetMaxCents", "renovationType", "desiredDays"]) {
    assert.ok(prompt.includes(field), `模型应知道字段 ${field}`);
  }
  assert.match(prompt, /人民币分/);
  assert.match(prompt, /elderly.*partial.*repair/);
});

test("live 传递完整多轮对话与纠正，完整草稿按公共契约返回", async (t) => {
  process.env.AI_MODE = "live";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://llm.example/v1";
  process.env.LLM_MODEL = "test-model";
  const messages = [
    { role: "user" as const, content: "深圳60平方米，适老化卫生间改造，30天完工。" },
    { role: "assistant" as const, content: "请补充预算范围。" },
    { role: "user" as const, content: "预算3万到5万元，城市改成广州。" },
  ];
  const expected = { reply: "请核对需求单", ready: true, missingFields: [], draft: {
    description: "卫生间适老化改造", city: "广州", areaM2: 60, budgetMinCents: 3000000,
    budgetMaxCents: 5000000, renovationType: "elderly", desiredDays: 30,
  } };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.messages.slice(1), messages);
    return Response.json({ choices: [{ message: { content: JSON.stringify(expected) } }] });
  });
  assert.deepEqual(await clarifyDemand({ messages }), { data: expected, source: "live" });
});

test("错误模式返回 503，不静默当作模拟成功", async (t) => {
  process.env.AI_MODE = "liv";
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("不应请求供应商"); });
  const response = await POST(new Request("http://localhost/api/demand/chat", { method: "POST", body: JSON.stringify(input) }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "AI_UNAVAILABLE");
  assert.equal("meta" in body, false);
  assert.equal(request.mock.callCount(), 0);
});

test("live 拒绝就绪状态矛盾、未知缺失字段及非法草稿，不回退模拟", async (t) => {
  process.env.AI_MODE = "live";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://llm.example/v1";
  process.env.LLM_MODEL = "test-model";
  process.env.LLM_MAX_RETRIES = "1";
  const draft = { description: "卫生间改造", city: "深圳", areaM2: 60, budgetMinCents: 3000000, budgetMaxCents: 5000000, renovationType: "elderly", desiredDays: 30 };
  for (const candidate of [
    { reply: "完成", ready: true, draft: null, missingFields: [] },
    { reply: "完成", ready: true, draft, missingFields: ["city"] },
    { reply: "继续", ready: false, draft, missingFields: ["city"] },
    { reply: "继续", ready: false, draft: null, missingFields: [] },
    { reply: "继续", ready: false, draft: null, missingFields: ["ownerId"] },
    { reply: "继续", ready: false, draft: null, missingFields: ["city", "city"] },
    { reply: "  ", ready: false, draft: null, missingFields: ["city"] },
    { reply: "完成", ready: true, draft: { ...draft, renovationType: "luxury" }, missingFields: [] },
    { reply: "完成", ready: true, draft: { ...draft, budgetMinCents: 6000000 }, missingFields: [] },
  ]) {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: JSON.stringify(candidate) } }] }));
    const response = await POST(new Request("http://localhost/api/demand/chat", { method: "POST", body: JSON.stringify(input) }));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "AI_UNAVAILABLE");
    assert.equal("data" in body, false);
    assert.equal("meta" in body, false);
    assert.equal(request.mock.callCount(), 2);
    t.mock.restoreAll();
  }
});

test("live 模式的非法响应在有限重试后失败", async (t) => {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://llm.example/v1";
  process.env.LLM_MODEL = "test-model";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return Response.json({ choices: [{ message: { content: "不是 JSON" } }] });
  });

  await assert.rejects(() => callLlmJson(ChatResult, [], { maxRetries: 2 }), (error: unknown) => {
    assert.ok(error instanceof LlmUnavailableError);
    assert.match((error as Error).message, /JSON/);
    return true;
  });
  assert.equal(calls, 3);
});

test("live 模式超时会中止请求并遵守重试上限", async (t) => {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://llm.example/v1";
  process.env.LLM_MODEL = "test-model";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string | URL, init?: RequestInit) => {
    calls += 1;
    await new Promise<void>((resolve) => {
      init?.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    throw new Error("aborted");
  });

  await assert.rejects(() => callLlmJson(ChatResult, [], { timeoutMs: 1, maxRetries: 2 }), LlmUnavailableError);
  assert.equal(calls, 3);
});
