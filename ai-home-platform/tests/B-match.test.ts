import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Match, envelope, type ProviderDTO } from "../src/contracts";
import { matchDemandFixture as demoDemand, matchProviderFixtures as providers, installMatchProtocolFixture } from "./B-match-fixtures";
import { matchProviders } from "../src/lib/match";
import { GET } from "../src/app/api/match/route";
import { prisma } from "../src/lib/prisma";

beforeEach(installMatchProtocolFixture);

const provider = (overrides: Partial<ProviderDTO> = {}): ProviderDTO => ({
  id: "test-provider", name: "测试施工团队", city: "深圳", kind: "construction",
  tags: ["适老化"], rating: 4, ...overrides,
});

test("匹配只保留同城施工团队，城市两侧空白不造成误排除", () => {
  const result = matchProviders({ ...demoDemand, city: " 深圳 " }, [
    provider({ id: "local", city: "深圳 " }),
    provider({ id: "remote", city: "广州", rating: 5 }),
    ...(["materials", "design", "supervision"] as const).map((kind) => provider({ id: kind, kind, rating: 5 })),
  ]);
  assert.deepEqual(result.map((row) => row.provider.id), ["local"]);
});

test("对应改造经验优先于高评分但无相关标签的团队，理由能说明差异", () => {
  const result = matchProviders(demoDemand, [
    provider({ id: "general", tags: ["维修"], rating: 5 }),
    provider({ id: "specialist", rating: 4 }),
  ]);
  assert.equal(result[0].provider.id, "specialist");
  assert.equal(result[0].score, 92);
  assert.equal(result[1].score, 40);
  assert.ok(result[0].reasons.some((reason) => reason.includes("适老化") && reason.includes("+60")));
  assert.ok(result[1].reasons.some((reason) => reason.includes("需进一步确认")));
});

test("改造类型变化会改变排序，而不是始终偏好适老化标签", () => {
  const candidates = [provider({ id: "elderly" }), provider({ id: "partial", tags: ["局部改造"] }), provider({ id: "repair", tags: ["维修"] })];
  for (const renovationType of ["elderly", "partial", "repair"] as const) {
    assert.equal(matchProviders({ ...demoDemand, renovationType }, candidates)[0].provider.id, renovationType);
  }
});

test("多位小数评分的理由保留原值，读者按展示公式可复算得分", () => {
  const [match] = matchProviders(demoDemand, [provider({ rating: 4.56 })]);
  assert.equal(match.score, 96);
  const reason = match.reasons.find((value) => value.startsWith("评分 "));
  assert.ok(reason);
  const values = /^评分 ([\d.]+)\/5：\+(\d+) 分/.exec(reason);
  assert.ok(values);
  assert.equal(Number(values[1]), 4.56);
  assert.equal(Number(values[2]), Math.round(Number(values[1]) * 8));
  assert.equal(match.score, 60 + Number(values[2]));
});

test("同分候选顺序稳定且不会原地修改输入数组或标签", () => {
  const candidates = [provider({ id: "b" }), provider({ id: "a" })];
  const original = structuredClone(candidates);
  const forward = matchProviders(demoDemand, candidates);
  const reverse = matchProviders(demoDemand, [...candidates].reverse());
  assert.deepEqual(forward.map((row) => row.provider.id), ["a", "b"]);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(candidates, original);
});

test("没有同城施工团队或需求城市为空时返回空结果，不回退到异地团队", () => {
  assert.deepEqual(matchProviders({ ...demoDemand, city: "上海" }, providers), []);
  assert.deepEqual(matchProviders({ ...demoDemand, city: " " }, providers), []);
  assert.deepEqual(matchProviders(demoDemand, []), []);
});

test("最高评分输出符合公共 Match 契约，且不虚构预算与档期满足情况", () => {
  const result = matchProviders(demoDemand, [provider({ rating: 5 })]);
  assert.equal(result[0].score, 100);
  assert.equal(Match.array().safeParse(result).success, true);
  assert.ok(result[0].reasons.every((reason) => !/满足预算|档期匹配|资质已验证/.test(reason)));
});

test("匹配 API 保留无参数演示需求并读取目录汇总，使用公共响应契约", async (t) => {
  const transaction = prisma.$transaction;
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => run({ review: { findMany: async () => [] } })) as typeof transaction;
  t.after(() => { prisma.$transaction = transaction; });
  const response = await GET(new Request("http://localhost/api/match"));
  assert.equal(response.status, 200);
  const body = envelope(Match.array()).parse(await response.json());
  assert.equal(body.meta.source, "mock");
  assert.deepEqual(body.data.map((row) => row.provider.id), ["fixture-a", "fixture-b"]);
  assert.ok(body.data.every(row => row.provider.source === "mock" && row.provider.performance?.source === "live"));
});

test("匹配 API 拒绝空、纯空白和重复 ID", async () => {
  for (const query of ["?demandId=", "?demandId=%20%20", "?demandId=demo-demand&demandId=other"]) {
    const response = await GET(new Request(`http://localhost/api/match${query}`));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: { code: "VALIDATION_ERROR", message: "匹配查询参数不符合契约。" } });
  }
});
