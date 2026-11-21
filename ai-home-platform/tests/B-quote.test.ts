import test from "node:test";
import assert from "node:assert/strict";
import { quotes, demoDemand, providers } from "../src/lib/mock-data";
import { getPendingQuoteItems, summarizeQuote } from "../src/lib/quote-engine";
import { matchProviders } from "../src/lib/match";
import { Quote, envelope, type QuoteDTO } from "../src/contracts";
import { prepareQuotes } from "../src/lib/quote-engine";
import { loadQuoteData } from "../src/lib/quote-engine/data";
import { GET, POST } from "../src/app/api/quote/route";
test("汇总已知费用并保留待确认项目",()=>{assert.deepEqual(summarizeQuote(quotes[0]),{knownTotalCents:1200000,pendingItems:["垃圾清运"]});});
test("施工匹配不混入异地或材料供应商",()=>{const result=matchProviders(demoDemand,providers);assert.equal(result.length,2);assert.ok(result.every(r=>r.provider.city==="深圳"&&r.provider.kind==="construction"));});

const quote = (overrides: Partial<QuoteDTO> = {}): QuoteDTO => ({ ...structuredClone(quotes[0]), ...overrides });
const item = (overrides: Partial<QuoteDTO["items"][number]> = {}): QuoteDTO["items"][number] => ({
  code: "test-item", name: "施工项目", unit: "job", quantity: 1, unitPriceCents: 101, amountCents: 101, note: "测试明细", ...overrides,
});

test("报价按明细重算过期合计，保持整数分且不修改输入", () => {
  const input = quote({ knownTotalCents: 999999, pendingItems: [], items: [item(), item({ code: "second", amountCents: 202 })] });
  const before = structuredClone(input);
  const [result] = prepareQuotes(demoDemand.id, [input]);
  assert.equal(result.knownTotalCents, 303);
  assert.deepEqual(input, before);
  assert.ok(Quote.safeParse(result).success);
});

test("未知金额不由数量乘单价补齐，明确零元与未知费用分别保留", () => {
  const input = quote({ pendingItems: [], items: [
    item({ code: "zero", name: "免费清运", amountCents: 0, unitPriceCents: 0 }),
    item({ code: "unknown", name: "现场增项", quantity: 2, unitPriceCents: 500, amountCents: null }),
  ] });
  const [result] = prepareQuotes(demoDemand.id, [input]);
  assert.equal(result.knownTotalCents, 0);
  assert.deepEqual(result.pendingItems, ["现场增项"]);
  assert.equal(result.items[0].amountCents, 0);
  assert.equal(result.items[1].amountCents, null);
});

test("单价未知或额外待确认费用不能因列明金额存在而消失", () => {
  const summary = summarizeQuote(quote({
    pendingItems: ["现场勘查", "现场勘查"],
    items: [item({ name: "材料", unitPriceCents: null, amountCents: 200 })],
  }));
  assert.deepEqual(summary, { knownTotalCents: 200, pendingItems: ["现场勘查", "材料"] });
});

test("同名不同编号的待确认明细分别保留，金额未知与单价未知均不漏项", () => {
  const input = quote({ pendingItems: ["垃圾清运"], items: [
    item({ code: "haul-bathroom", name: "垃圾清运", amountCents: null }),
    item({ code: "haul-kitchen", name: "垃圾清运", amountCents: 500, unitPriceCents: null }),
    item({ code: "haul-bedroom", name: "垃圾清运", amountCents: 200, unitPriceCents: 200 }),
  ] });
  const before = structuredClone(input);
  const pending = getPendingQuoteItems(input);
  assert.deepEqual(pending.items.map((value) => value.code), ["haul-bathroom", "haul-kitchen"]);
  assert.deepEqual(pending.extraNames, []);
  assert.deepEqual(summarizeQuote(input), { knownTotalCents: 700, pendingItems: ["垃圾清运", "垃圾清运"] });
  assert.deepEqual(input, before);
});

test("名称数组往返公共契约后重复汇总不增加或合并同名明细，额外费用保留", () => {
  const input = quote({ pendingItems: ["现场勘查", "现场勘查", "垃圾清运"], items: [
    item({ code: "haul-a", name: "垃圾清运", amountCents: null }),
    item({ code: "haul-b", name: "垃圾清运", amountCents: null }),
  ] });
  const [first] = prepareQuotes(demoDemand.id, [input]);
  const parsed = Quote.parse(JSON.parse(JSON.stringify(first)));
  const [second] = prepareQuotes(demoDemand.id, [parsed]);
  assert.deepEqual(first.pendingItems, ["现场勘查", "垃圾清运", "垃圾清运"]);
  assert.deepEqual(first, second);
  assert.deepEqual(getPendingQuoteItems(second).extraNames, ["现场勘查"]);
});

test("只返回当前需求已提交和已接受报价，保留原顺序而非以小计判最低价", () => {
  const result = prepareQuotes(demoDemand.id, [
    quote({ id: "submitted", status: "submitted" }),
    quote({ id: "other", demandId: "another-demand" }),
    quote({ id: "draft", status: "draft" }),
    quote({ id: "rejected", status: "rejected" }),
    quote({ id: "accepted", status: "accepted", items: [item({ amountCents: 1 })] }),
  ]);
  assert.deepEqual(result.map((value) => value.id), ["submitted", "accepted"]);
  assert.deepEqual(prepareQuotes("no-quotes", quotes), []);
});

test("空明细只产生空的已知小计，并保留声明的待确认项", () => {
  assert.deepEqual(summarizeQuote(quote({ items: [], pendingItems: ["现场报价"] })), { knownTotalCents: 0, pendingItems: ["现场报价"] });
});

test("拒绝负数、小数分、非有限金额及累计安全整数溢出", () => {
  for (const amountCents of [-1, 1.5, Infinity, NaN]) {
    assert.throws(() => summarizeQuote(quote({ items: [item({ amountCents })] })));
  }
  assert.equal(summarizeQuote(quote({ items: [item({ amountCents: Number.MAX_SAFE_INTEGER })] })).knownTotalCents, Number.MAX_SAFE_INTEGER);
  assert.throws(() => summarizeQuote(quote({ items: [item({ amountCents: Number.MAX_SAFE_INTEGER }), item({ amountCents: 1 })] })));
});

test("报价数据入口不会将未知需求替换成演示需求", () => {
  const data = loadQuoteData(demoDemand.id);
  assert.ok(data);
  assert.equal(data.demand.id, demoDemand.id);
  assert.ok(data.response.data.every((value) => value.demandId === data.demand.id));
  assert.equal(data.response.meta.source, "mock");
  assert.equal(loadQuoteData("another-demand"), null);
  assert.equal(loadQuoteData(""), null);
});

test("报价 GET 保持公共契约和 mock 来源，默认未登录的 POST 明确失败", async () => {
  const response = await GET(new Request("http://localhost/api/quote"));
  assert.equal(response.status, 200);
  const body = envelope(Quote.array()).parse(await response.json());
  assert.equal(body.meta.source, "mock");
  assert.deepEqual(body.data.map((value) => value.knownTotalCents), [1200000, 1300000]);
  assert.equal(body.data[0].items[1].amountCents, null);
  assert.deepEqual(body.data[0].pendingItems, ["垃圾清运"]);
  const failure = await POST(new Request("http://localhost/api/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demandId: demoDemand.id, estimatedDays: 10, items: [{ code: "test", name: "测试", unit: "job", quantity: 1, unitPriceCents: 100, note: "" }] }),
  }));
  assert.equal(failure.status, 401);
  const failed = await failure.json();
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "UNAUTHENTICATED");
});
