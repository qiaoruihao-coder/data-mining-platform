import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, DemoProviderSession, OwnerSessionState,
  Quote, QuoteSubmissionInput, envelope,
} from "../src/contracts";

const origin = "https://localhost:3000";
// 仅供隔离测试的合成凭证，不开通本机账号，不读取真实用户密码。
const credentials = { login: "b-flow-owner", password: "Synthetic B flow password 42!" };
function request(path: string, method = "GET", cookie = "", body?: unknown, key?: string) {
  return new Request(`${origin}${path}`, {
    method, headers: { origin, cookie, "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function privateResponse(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.equal("data" in body, false);
  assert.equal("meta" in body, false);
  return body;
}

test("公开登录与报价路由串联：真实密码校验、cookie 和 SQLite；需求归属为预置夹具", async t => {
  const previousUrl = process.env.DATABASE_URL;
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-B-login-flow-"));
  const databasePath = join(fixture, "flow.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  let disconnect: (() => Promise<void>) | undefined;
  t.after(async () => {
    await disconnect?.();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED; else process.env.DEMO_AUTH_ENABLED = previousDemo;
    const target = resolve(fixture);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-B-login-flow-"));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DEMO_AUTH_ENABLED = "true";
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  // 环境就绪后加载默认单例及公开路由：不注入 reader，不直接签发会话，不 mock fetch。
  const { prisma: db } = await import("../src/lib/prisma");
  disconnect = () => db.$disconnect();
  const ownerApi = await import("../src/app/api/auth/owner/route");
  const providerApi = await import("../src/app/api/auth/demo-provider/route");
  const quoteApi = await import("../src/app/api/quote/route");
  const { createOwnerAccount } = await import("../src/lib/owner-account");
  const owner = await createOwnerAccount({ ...credentials, name: "Synthetic B owner" }, db);
  const otherCredentials = { ...credentials, login: "b-flow-other" };
  const other = await createOwnerAccount({ ...otherCredentials, name: "Synthetic other owner" }, db);
  await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" } });
  await db.user.create({ data: { id: DEMO_PROVIDER_USER_ID, name: "Synthetic demo provider", role: "provider", providerId: DEMO_PROVIDER_ID } });

  const loginOwner = async (input = credentials, cookie = "") => {
    const response = await ownerApi.POST(request("/api/auth/owner", "POST", cookie, input));
    assert.equal(response.status, 200);
    privateResponse(response);
    const result = envelope(OwnerSessionState).parse(await response.json());
    assert.equal(result.meta.source, "live");
    assert.equal(result.data.status, "signed_in");
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie);
    return setCookie.split(";")[0];
  };
  const providerLogin = await providerApi.POST(request("/api/auth/demo-provider", "POST", "", { action: "login_demo" }));
  assert.equal(providerLogin.status, 200);
  const providerSession = envelope(DemoProviderSession).parse(await providerLogin.json());
  assert.equal(providerSession.meta.source, "mock");
  assert.equal(providerSession.data.status, "signed_in");
  const providerCookie = providerLogin.headers.get("set-cookie")!.split(";")[0];
  const ownerCookie = await loginOwner();
  const otherCookie = await loginOwner(otherCredentials);
  const inputFor = (id: string) => QuoteSubmissionInput.parse({ demandId: id, estimatedDays: 5, items: [
    { code: "known", name: "合成测试费用", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "合成数据" },
    { code: "pending", name: "待确认", unit: "piece", quantity: 1, unitPriceCents: null, note: "" },
    { code: "zero", name: "零元", unit: "piece", quantity: 1, unitPriceCents: 0, note: "" },
  ] });
  const seedDemand = (id: string, ownerId = owner.userId) => db.demandOrder.create({ data: {
    id, ownerId, description: "Synthetic demand with explicit test ownership", city: "Test", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5, status: "published",
  } });
  const submit = (id: string, cookie = providerCookie) => quoteApi.POST(request("/api/quote", "POST", cookie, inputFor(id), `b-login-flow-key-${id}`));
  const readResponse = async (id: string, cookie = ownerCookie) => {
    const response = await quoteApi.GET(request(`/api/quote?demandId=${encodeURIComponent(id)}`, "GET", cookie));
    privateResponse(response);
    return response;
  };
  const read = async (id: string, cookie = ownerCookie) => {
    const response = await readResponse(id, cookie);
    assert.equal(response.status, 200);
    return envelope(Quote.array()).parse(await response.json());
  };

  await t.test("密码登录后从空列表到 POST 201、GET 读回、同键重放，保留 ID/金额/null/来源", async () => {
    const id = "b-flow-submit";
    await seedDemand(id);
    assert.deepEqual((await read(id)).data, []);
    const response = await submit(id);
    assert.equal(response.status, 201);
    const first = envelope(Quote).parse(await response.json());
    assert.equal(first.meta.source, "mock");
    assert.equal(first.data.source, "mock");
    assert.equal(first.data.providerId, DEMO_PROVIDER_ID);
    assert.equal(first.data.knownTotalCents, 15);
    assert.deepEqual(first.data.items.map(item => item.amountCents), [15, null, 0]);
    assert.deepEqual(first.data.pendingItems, ["待确认"]);
    await db.$disconnect();
    const saved = await read(id);
    assert.deepEqual(saved.data, [first.data]);
    assert.equal(saved.meta.source, "mock");
    const replay = await submit(id);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), first);
    assert.deepEqual((await read(id)).data, [first.data]);
    assert.equal(await db.quote.count({ where: { demandId: id } }), 1);
    assert.equal(await db.quoteSubmissionReceipt.count({ where: { quoteId: first.data.id } }), 1);
    // 需求关闭后不能重报，但业主仍能查看已提交的报价。
    await db.demandOrder.update({ where: { id }, data: { status: "completed" } });
    await denied(await submit(id), 409, "INVALID_STATE");
    assert.deepEqual((await read(id)).data, [first.data]);
  });

  await t.test("匿名 401、仅服务方 403、跨业主与未知需求同为 404；拒绝不改变保存结果", async () => {
    const id = "b-flow-isolation";
    await seedDemand(id);
    const submitted = await submit(id);
    assert.equal(submitted.status, 201);
    const saved = envelope(Quote).parse(await submitted.json());
    await denied(await readResponse(id, ""), 401, "UNAUTHENTICATED");
    await denied(await readResponse(id, providerCookie), 403, "FORBIDDEN");
    const crossOwner = await denied(await readResponse(id, otherCookie), 404, "DEMAND_NOT_FOUND");
    const missing = await denied(await readResponse("b-flow-missing", otherCookie), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(crossOwner, missing);
    await seedDemand("b-flow-other-empty", other.userId);
    assert.deepEqual((await read("b-flow-other-empty", otherCookie)).data, []);
    assert.deepEqual((await read(id)).data, [saved.data]);
    assert.equal(await db.quote.count({ where: { demandId: id } }), 1);
  });

  await t.test("同一浏览器的双身份分别用于提交和读取；切换业主后不能沿用原需求权限", async () => {
    const id = "b-flow-dual-session";
    await seedDemand(id);
    const combined = `${ownerCookie}; ${providerCookie}`;
    const response = await submit(id, combined);
    assert.equal(response.status, 201);
    const saved = envelope(Quote).parse(await response.json());
    assert.deepEqual((await read(id, combined)).data, [saved.data]);
    const switched = await loginOwner(otherCredentials, combined);
    await denied(await readResponse(id, `${switched}; ${providerCookie}`), 404, "DEMAND_NOT_FOUND");
    // 旧业主 cookie 被轮换撤销，即使还携带有效服务方 cookie，也不回退身份。
    await denied(await readResponse(id, combined), 401, "UNAUTHENTICATED");
    assert.equal((await submit(id, providerCookie)).status, 200);
  });

  await t.test("业主退出后原 cookie 被拒绝；再次密码登录可读取原报价，不重复提交", async () => {
    const id = "b-flow-logout";
    await seedDemand(id);
    const submitted = await submit(id);
    assert.equal(submitted.status, 201);
    const saved = envelope(Quote).parse(await submitted.json());
    const cookie = await loginOwner();
    assert.deepEqual((await read(id, cookie)).data, [saved.data]);
    const logout = await ownerApi.DELETE(request("/api/auth/owner", "DELETE", cookie));
    assert.equal(logout.status, 200);
    assert.equal(envelope(OwnerSessionState).parse(await logout.json()).data.status, "signed_out");
    await denied(await readResponse(id, cookie), 401, "UNAUTHENTICATED");
    const relogged = await loginOwner();
    assert.deepEqual((await read(id, relogged)).data, [saved.data]);
    assert.equal(await db.quote.count({ where: { demandId: id } }), 1);
  });
});
