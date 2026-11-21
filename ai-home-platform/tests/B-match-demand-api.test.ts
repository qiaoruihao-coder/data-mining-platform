import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Match, envelope, type DemandDTO } from "../src/contracts";
import { matchDemandFixture as demoDemand, installMatchProtocolFixture } from "./B-match-fixtures";
import { prisma } from "../src/lib/prisma";
import { GET } from "../src/app/api/match/route";

beforeEach(installMatchProtocolFixture);

// Prisma 的代理方法没有普通 value 描述符，使用可恢复的显式替换隔离真实数据库。
function mockLookup(t: TestContext, implementation: (args: { where: { id: string; status: string } }) => Promise<unknown>) {
  const transaction = prisma.$transaction;
  const lookup = t.mock.fn(async (args: { where: { id: string; status: string } }) => {
    assert.equal(args.where.status, "published");
    return implementation(args);
  });
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return run({ demandOrder: { findFirst: lookup }, review: { findMany: async () => [] } });
  }) as typeof transaction;
  t.after(() => { prisma.$transaction = transaction; });
  return lookup;
}

const request = (id: string) => new Request(`http://localhost/api/match?demandId=${encodeURIComponent(id)}`);
const success = async (id: string) => {
  const response = await GET(request(id));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  const body = envelope(Match.array()).parse(await response.json());
  assert.equal(body.meta.source, "mock");
  return body.data;
};

test("已保存需求按实际城市及改造类型匹配，真实需求配模拟团队仍标 mock", async (t) => {
  const rows: DemandDTO[] = [
    { ...demoDemand, id: "saved-repair", renovationType: "repair" },
    { ...demoDemand, id: "saved-partial", city: "广州", renovationType: "partial" },
    { ...demoDemand, id: "saved-empty", city: "上海" },
  ];
  const queried: string[] = [];
  mockLookup(t, async ({ where }) => {
    queried.push(where.id);
    return rows.find((row) => row.id === where.id) ?? null;
  });
  const repair = await success(rows[0].id);
  assert.deepEqual(repair.map((match) => match.provider.id), ["fixture-b", "fixture-a"]);
  assert.ok(repair[0].reasons.some((reason) => reason.includes("维修") && reason.includes("+60")));
  assert.ok(repair.every((match) => match.provider.city === "深圳" && match.provider.kind === "construction"));
  const partial = await success(rows[1].id);
  assert.deepEqual(partial.map((match) => match.provider.id), ["fixture-remote"]);
  assert.ok(partial[0].reasons.some((reason) => reason.includes("局部改造") && reason.includes("+60")));
  assert.deepEqual(await success(rows[2].id), []);
  assert.deepEqual(queried, rows.map((row) => row.id));
});

test("每次请求重新读取需求，更新后改变匹配，删除后返回 404 而非缓存结果", async (t) => {
  let row: DemandDTO | null = { ...demoDemand, id: "saved-changing" };
  mockLookup(t, async () => row);
  assert.deepEqual((await success("saved-changing")).map((match) => match.provider.id), ["fixture-a", "fixture-b"]);
  row = { ...row, city: "广州", renovationType: "partial" };
  assert.deepEqual((await success("saved-changing")).map((match) => match.provider.id), ["fixture-remote"]);
  row = null;
  const response = await GET(request("saved-changing"));
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "DEMAND_NOT_FOUND");
  assert.equal("data" in body, false);
});

test("只有省略参数走固定演示入口，显式 demo-demand 必须存在于数据库", async (t) => {
  let row: DemandDTO | null = null;
  const lookup = mockLookup(t, async () => row);
  const demo = await GET(new Request("http://localhost/api/match"));
  assert.equal(demo.status, 200);
  const demoBody = envelope(Match.array()).parse(await demo.json());
  assert.equal(demoBody.meta.source, "mock");
  assert.deepEqual(demoBody.data.map(match => match.provider.id), ["fixture-a", "fixture-b"]);
  assert.equal(lookup.mock.callCount(), 0);
  const explicit = await GET(request("demo-demand"));
  assert.equal(explicit.status, 404);
  const missing = await explicit.json();
  assert.equal(missing.error.code, "DEMAND_NOT_FOUND");
  assert.equal("data" in missing, false);
  assert.equal(lookup.mock.callCount(), 1);
  row = demoDemand;
  assert.deepEqual((await success("demo-demand")).map((match) => match.provider.id), ["fixture-a", "fixture-b"]);
});

test("非法或重复参数在查询前被拒绝，合法特殊字符 ID 原样传入服务", async (t) => {
  const id = "需求/a?b#c%20";
  const lookup = mockLookup(t, async ({ where }) => {
    assert.equal(where.id, id);
    return { ...demoDemand, id };
  });
  for (const query of ["?demandId=", "?demandId=%20%09", "?demandId=a&demandId=a", "?demandId=&demandId=demo-demand", "?unknown=1", "?demandId=a&ownerId=other"]) {
    const response = await GET(new Request(`http://localhost/api/match${query}`));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal("data" in body, false);
  }
  assert.equal(lookup.mock.callCount(), 0);
  await success(id);
  assert.equal(lookup.mock.callCount(), 1);
});

test("数据库异常、契约不符或返回其他需求均返回 503，不泄露异常或回退模拟成功", async (t) => {
  let reply: () => Promise<unknown>;
  mockLookup(t, () => reply());
  for (const lookup of [
    async () => { throw new Error("internal database detail"); },
    async () => ({ ...demoDemand, id: "saved", renovationType: "unsupported" }),
    async () => ({ ...demoDemand, id: "another-demand" }),
  ]) {
    reply = lookup;
    for (const id of ["saved", "demo-demand"]) {
      const response = await GET(request(id));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: { code: "DATABASE_UNAVAILABLE", message: "需求数据暂时无法读取，请稍后重试。" },
      });
    }
    const demo = await GET(new Request("http://localhost/api/match"));
    assert.equal(demo.status, 200);
    assert.equal(envelope(Match.array()).parse(await demo.json()).meta.source, "mock");
  }
});

test("授权或参数拒绝时不读目录；目录失败仍保留私有响应头", async t => {
  const transaction = prisma.$transaction;
  let directoryReads = 0;
  let publish = false;
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => run({
    demandOrder: { findFirst: async () => publish ? { ...demoDemand, id: "saved" } : null },
    ownerSession: { findUnique: async () => null },
    review: { findMany: async () => { directoryReads++; throw Error("private directory failure"); } },
  })) as typeof transaction;
  t.after(() => { prisma.$transaction = transaction; });
  for (const [path, cookie, status] of [
    ["?unknown=1", "", 400], ["?demandId=saved", "", 404],
    ["?demandId=saved", "__Host-ai_home_owner_session=bad", 401],
    ["", "__Host-ai_home_owner_session=bad", 401],
  ] as const) {
    const response = await GET(new Request(`http://localhost/api/match${path}`, { headers: { cookie } }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(directoryReads, 0);
  }
  publish = true;
  const response = await GET(request("saved"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  const body = await response.json();
  assert.equal(body.error.code, "PROVIDER_UNAVAILABLE");
  assert.equal("data" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private directory/);
  assert.equal(directoryReads, 1);
});
