import test from "node:test";
import assert from "node:assert/strict";
import { DemandInput } from "../src/contracts";
import {
  EMPTY_FORM,
  MAX_MESSAGES,
  appendMessage,
  describeFailure,
  demandPath,
  formFromDraft,
  formToInput,
  interpretDemandSubmit,
  normalizeOutgoing,
  parseChatResponse,
  sourceLabel,
  toChatPayload,
  submitDemand,
  yuanToCents,
  type ChatMessage,
} from "../src/features/a/demand-chat";

test("来源枚举转换为业主可理解的文案", () => {
  assert.equal(sourceLabel("mock"), "模拟结果");
  assert.equal(sourceLabel("live"), "实时结果");
  assert.equal(sourceLabel(null), "尚未确认");
});

test("空消息与超长消息在本地被拦下，不发给接口", () => {
  assert.equal(normalizeOutgoing("   ").ok, false);
  assert.equal(normalizeOutgoing("x".repeat(4001)).ok, false);
  const ok = normalizeOutgoing("  深圳 60 平老房  ");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value, "深圳 60 平老房");
});

const confirmationForm = {
  ...EMPTY_FORM,
  description: "  卫生间防滑施工  ",
  city: " 深圳 ",
  areaM2: "6",
  budgetMinYuan: "19.99",
  budgetMaxYuan: "3000",
  desiredDays: "3",
};

const savedDemand = {
  id: "demand-confirmation-1",
  ...DemandInput.parse({
    description: "卫生间防滑施工", city: "深圳", areaM2: 6,
    budgetMinCents: 1999, budgetMaxCents: 300000,
    renovationType: "elderly", desiredDays: 3,
  }),
  status: "published",
};

test("确认前按公共契约校验；非法表单不发送请求", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("非法表单不应请求接口");
  });
  const result = await submitDemand({ ...confirmationForm, budgetMinYuan: "4000" });
  assert.equal(result.kind, "rejected");
  assert.equal(request.mock.callCount(), 0);
});

test("确认保存通过共享客户端提交 DemandInput，保留返回 ID 与真实/模拟来源", async (t) => {
  for (const source of ["live", "mock"] as const) {
    const request = t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      assert.equal(url, "/api/demand");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      const input = DemandInput.parse(JSON.parse(String(init?.body)));
      assert.equal(input.description, "卫生间防滑施工");
      assert.equal(input.city, "深圳");
      assert.equal(input.budgetMinCents, 1999);
      return Response.json({ ok: true, data: savedDemand, meta: { source } }, { status: 201 });
    });
    const result = await submitDemand(confirmationForm);
    assert.equal(request.mock.callCount(), 1);
    assert.equal(result.kind, "created");
    if (result.kind === "created") {
      assert.equal(result.source, source);
      assert.equal(result.demand.id, savedDemand.id);
      assert.equal(demandPath(result.demand.id), `/owner/demand/${savedDemand.id}`);
    }
    t.mock.restoreAll();
  }
});

test("400 保留拒绝原因；501 即使响应伪装成功也只显示未开放", async (t) => {
  const responses = [
    { response: Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "预算范围无效" } }, { status: 400 }), kind: "rejected" },
    { response: Response.json({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "尚未开放" } }, { status: 501 }), kind: "not_implemented" },
    { response: new Response("not json", { status: 501 }), kind: "not_implemented" },
    { response: Response.json({ ok: true, data: savedDemand, meta: { source: "live" } }, { status: 501 }), kind: "not_implemented" },
  ];
  for (const { response, kind } of responses) {
    t.mock.method(globalThis, "fetch", async () => response);
    const result = await submitDemand(confirmationForm);
    assert.equal(result.kind, kind);
    assert.equal("demand" in result, false);
    if (result.kind === "rejected") assert.match(result.messages.join(" "), /预算范围无效/);
    t.mock.restoreAll();
  }
});

test("401 明确引导业主登录并保留表单，403 明确提示权限问题", () => {
  const auth = interpretDemandSubmit(401, {
    ok: false, error: { code: "UNAUTHENTICATED", message: "请先完成业主登录后发布需求。" },
  });
  assert.equal(auth.kind, "auth_required");
  if (auth.kind === "auth_required") {
    assert.match(auth.message, /业主登录/);
    assert.match(auth.message, /内容仍保留/);
  }

  const forbidden = interpretDemandSubmit(403, {
    ok: false, error: { code: "FORBIDDEN", message: "当前请求没有需求创建权限。" },
  });
  assert.equal(forbidden.kind, "forbidden");
  if (forbidden.kind === "forbidden") {
    assert.match(forbidden.message, /权限/);
    assert.match(forbidden.message, /内容仍保留/);
  }
});

test("保存失败保留服务端说明，但不把错误码或 HTTP 状态码展示给业主", () => {
  const result = interpretDemandSubmit(503, {
    ok: false,
    error: { code: "DEMAND_UNAVAILABLE", message: "需求服务暂时不可用，请稍后重试。" },
  });
  assert.deepEqual(result, { kind: "failed", message: "需求服务暂时不可用，请稍后重试。" });

  const malformed = interpretDemandSubmit(500, "not json");
  assert.deepEqual(malformed, { kind: "failed", message: "服务暂时无法完成保存，请稍后重试。" });
  if (malformed.kind === "failed") assert.doesNotMatch(malformed.message, /HTTP 500|DEMAND_UNAVAILABLE/);
});

test("错误 JSON、缺失来源、错误信封与 503 均不能生成成功态", async (t) => {
  const responses = [
    new Response("invalid", { status: 201 }),
    Response.json({ ok: true, data: savedDemand }, { status: 201 }),
    Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "失败" } }),
    Response.json({ ok: true, data: { ...savedDemand, id: "" }, meta: { source: "live" } }),
    Response.json({ ok: false, error: { code: "UNAVAILABLE", message: "服务不可用" } }, { status: 503 }),
  ];
  for (const response of responses) {
    t.mock.method(globalThis, "fetch", async () => response);
    const result = await submitDemand(confirmationForm);
    assert.equal(result.kind, "failed");
    assert.equal("demand" in result, false);
    t.mock.restoreAll();
  }
});

test("网络失败不自动重试创建；用户重试可接收成功结果", async (t) => {
  let attempts = 0;
  const request = t.mock.method(globalThis, "fetch", async () => {
    if (++attempts === 1) throw new TypeError("Failed to fetch");
    return Response.json({ ok: true, data: savedDemand, meta: { source: "live" } }, { status: 201 });
  });
  assert.equal((await submitDemand(confirmationForm)).kind, "failed");
  assert.equal(request.mock.callCount(), 1);
  assert.equal((await submitDemand(confirmationForm)).kind, "created");
  assert.equal(request.mock.callCount(), 2);
});

test("对话历史裁剪到契约允许的 30 条且保留最新消息", () => {
  let messages: ChatMessage[] = [{ role: "assistant", content: "开场" }];
  for (let index = 0; index < 40; index += 1) {
    messages = appendMessage(messages, { role: "user", content: `第 ${index} 条` });
  }
  assert.equal(messages.length, MAX_MESSAGES);
  assert.equal(messages.at(-1)?.content, "第 39 条");
  assert.equal(toChatPayload(messages).messages.length, MAX_MESSAGES);
});

test("空白消息不会进入请求体", () => {
  const payload = toChatPayload([
    { role: "assistant", content: "开场" },
    { role: "user", content: "   " },
  ]);
  assert.equal(payload.messages.length, 1);
});

test("元转分只接受非负两位小数，且不产生浮点尾数", () => {
  assert.equal(yuanToCents("30000"), 3000000);
  assert.equal(yuanToCents("1.5"), 150);
  assert.equal(yuanToCents("0.07"), 7);
  assert.equal(yuanToCents("19.99"), 1999);
  for (const bad of ["", "-1", "1.234", "abc", "1e3"]) {
    assert.equal(yuanToCents(bad), null, `应拒绝 ${bad}`);
  }
});

test("表单转契约：倒置预算与非法工期被拒，并给出中文字段提示", () => {
  const base = {
    ...EMPTY_FORM,
    description: "深圳 60 平老房适老化改造",
    city: "深圳",
    areaM2: "60",
    budgetMinYuan: "30000",
    budgetMaxYuan: "50000",
    desiredDays: "30",
  };
  const ok = formToInput(base);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.budgetMinCents, 3000000);

  const inverted = formToInput({ ...base, budgetMinYuan: "60000" });
  assert.equal(inverted.ok, false);
  if (!inverted.ok) assert.ok(inverted.messages.some((message) => message.includes("预算")));

  const noDays = formToInput({ ...base, desiredDays: "0" });
  assert.equal(noDays.ok, false);
  if (!noDays.ok) assert.ok(noDays.messages.some((message) => message.includes("期望工期")));

  const badArea = formToInput({ ...base, areaM2: "六十" });
  assert.equal(badArea.ok, false);
});

test("草稿映射成表单；无草稿时给空表单，不虚构数值", () => {
  assert.deepEqual(formFromDraft(null), EMPTY_FORM);
  const form = formFromDraft({
    description: "浴室防滑",
    city: "深圳",
    areaM2: 60,
    budgetMinCents: 3000000,
    budgetMaxCents: 5000000,
    renovationType: "elderly",
    desiredDays: 30,
  });
  assert.equal(form.budgetMinYuan, "30000");
  assert.equal(form.budgetMaxYuan, "50000");
  assert.equal(form.areaM2, "60");
});

test("对话响应缺 meta.source 或字段不符时按契约失败处理", () => {
  const data = { reply: "请补充预算", ready: false, draft: null, missingFields: ["budgetMinCents"] };
  assert.throws(() => parseChatResponse({ ok: true, data }));
  assert.throws(() => parseChatResponse({ ok: true, data: { ...data, ready: "no" }, meta: { source: "mock" } }));
  const parsed = parseChatResponse({ ok: true, data, meta: { source: "mock" } });
  assert.equal(parsed.source, "mock");
  assert.deepEqual(parsed.data.missingFields, ["budgetMinCents"]);
});

test("501 判为未开放，不会被当作保存成功", () => {
  const payload = { ok: false, error: { code: "NOT_IMPLEMENTED", message: "这是开工骨架，此操作尚未实现。" } };
  const failure = describeFailure(501, payload);
  assert.equal(failure.notImplemented, true);
  const outcome = interpretDemandSubmit(501, payload);
  assert.equal(outcome.kind, "not_implemented");

  const rejected = interpretDemandSubmit(400, {
    ok: false,
    error: { code: "VALIDATION_ERROR", message: "需求格式不符合契约" },
  });
  assert.equal(rejected.kind, "rejected");

  assert.equal(interpretDemandSubmit(200, { ok: true, data: {} }).kind, "failed");
});

test("成功信封能被解析，并带出需求 ID 与来源", () => {
  const demand = {
    id: "demand-123",
    description: "浴室防滑",
    city: "深圳",
    areaM2: 60,
    budgetMinCents: 3000000,
    budgetMaxCents: 5000000,
    renovationType: "elderly",
    desiredDays: 30,
    status: "draft",
  };
  const outcome = interpretDemandSubmit(200, { ok: true, data: demand, meta: { source: "mock" } });
  assert.equal(outcome.kind, "created");
  if (outcome.kind === "created") {
    assert.equal(outcome.demand.id, "demand-123");
    assert.equal(outcome.source, "mock");
  }
});
