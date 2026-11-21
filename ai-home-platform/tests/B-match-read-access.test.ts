import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Match, envelope, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID } from "../src/contracts";

// 缺省测试实际路由；构建后 B_MATCH_HTTP=1 用相同矩阵验证真实生产 HTTP。
// 账号、需求与持久化会话均为专用临时 SQLite 夹具，不使用本机用户数据。
test("匹配 API 权限接线：隔离 SQLite、真实会话与完整响应头", async t => {
  const previousUrl = process.env.DATABASE_URL;
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-B-match-access-"));
  const databasePath = join(fixture, "matching.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  let disconnect: (() => Promise<void>) | undefined;
  let stop: (() => Promise<void>) | undefined;
  t.after(async () => {
    await stop?.();
    await disconnect?.();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED; else process.env.DEMO_AUTH_ENABLED = previousDemo;
    assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-B-match-access-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DEMO_AUTH_ENABLED = "true";
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const { prisma: db } = await import("../src/lib/prisma");
  disconnect = () => db.$disconnect();
  const { GET } = await import("../src/app/api/match/route");
  const { issueOwnerSession, OWNER_SESSION_COOKIE } = await import("../src/lib/owner-auth");
  const { issueDemoSession, DEMO_SESSION_COOKIE } = await import("../src/lib/demo-provider-session");
  let origin = "http://127.0.0.1:3000";
  if (process.env.B_MATCH_HTTP === "1") {
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const address = reservation.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    origin = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: { ...process.env, DATABASE_URL: databaseUrl, AI_MODE: "mock", NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let output = "";
    server.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-8000); });
    server.stderr.on("data", chunk => { output = (output + String(chunk)).slice(-8000); });
    const exited = new Promise<void>((resolve, reject) => { server.once("exit", () => resolve()); server.once("error", reject); });
    stop = async () => {
      if (server.exitCode !== null || server.signalCode !== null) return;
      server.kill();
      const force = setTimeout(() => server.kill("SIGKILL"), 2000);
      try { await exited; } finally { clearTimeout(force); }
    };
    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && server.exitCode === null && !ready) {
      ready = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok, () => false);
      if (!ready) await delay(100);
    }
    assert.ok(ready, `Production server did not start: ${output}`);
  }
  const request = (query: string, cookie = "", method = "GET") => new Request(`${origin}/api/match${query}`, { method, headers: { cookie, origin } });
  const read = async (query: string, cookie = "", method = "GET") => {
    const input = request(query, cookie, method);
    const response = process.env.B_MATCH_HTTP === "1" ? await fetch(input) : await GET(input);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    // 生产 Next.js 会追加 RSC 等字段；Cookie 必须作为独立的 Vary token 保留。
    assert.ok(response.headers.get("vary")?.split(",").map(value => value.trim().toLowerCase()).includes("cookie"));
    return response;
  };
  const query = (id: string) => `?demandId=${encodeURIComponent(id)}`;
  const rejected = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["error", "ok"]);
    assert.equal(body.error.code, code);
    assert.equal(body.ok, false);
    assert.doesNotMatch(JSON.stringify(body), /ownerId|tokenHash|Synthetic private/);
    return body;
  };
  const allowed = async (response: Response) => {
    assert.equal(response.status, 200);
    const body = envelope(Match.array()).parse(await response.json());
    assert.equal(body.meta.source, "mock"); // 当前目录仍是固定 mock；授权不会升级来源。
    assert.ok(body.data.length > 0);
    return body;
  };
  await db.user.createMany({ data: ["one", "two"].map(id => ({ id, name: "Synthetic owner", role: "owner" })) });
  await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "Synthetic provider", city: "深圳", kind: "construction", tagsJson: "[]" } });
  await db.user.create({ data: { id: DEMO_PROVIDER_USER_ID, name: "Synthetic provider account", role: "provider", providerId: DEMO_PROVIDER_ID } });
  const issue = (userId: string) => db.$transaction(tx => issueOwnerSession({ userId, role: "owner", providerId: null }, tx));
  const issued = await issue("one");
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await issue("two")).cookie.split(";")[0];
  const providerCookie = `${DEMO_SESSION_COOKIE}=${(await issueDemoSession(request("", "", "POST"), db)).token}`;
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  const statuses = ["draft", "published", "contracted", "in_progress", "completed"];
  await db.demandOrder.createMany({ data: statuses.flatMap(status => ["one", "two"].map(ownerId => ({
    id: `${ownerId}-${status}`, ownerId, status, description: "Synthetic private demand", city: "深圳", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "elderly", desiredDays: 5,
  }))) });

  await t.test("匿名/服务方只读 published，非公开与不存在同一 404", async () => {
    for (const identity of ["", providerCookie]) {
      await allowed(await read(query("one-published"), identity));
      const missing = await rejected(await read(query("missing"), identity), 404, "DEMAND_NOT_FOUND");
      for (const status of statuses.filter(status => status !== "published")) {
        assert.deepEqual(await rejected(await read(query(`one-${status}`), identity), 404, "DEMAND_NOT_FOUND"), missing);
      }
    }
  });
  await t.test("本人可读全部状态，他人只读 published；双 cookie 以业主为准", async () => {
    for (const status of statuses) await allowed(await read(query(`one-${status}`), cookie));
    for (const status of statuses.filter(status => status !== "published")) await rejected(await read(query(`one-${status}`), otherCookie), 404, "DEMAND_NOT_FOUND");
    await allowed(await read(query("one-draft"), `${providerCookie}; ${cookie}`));
    await allowed(await read(query("two-published"), cookie));
    const head = await read(query("one-draft"), "", "HEAD");
    assert.equal(head.status, 404);
  });
  await t.test("失效/重复/过期/撤销业主 cookie 返回 401，演示及公开入口也不回退", async () => {
    for (const invalid of [`${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`, `${providerCookie}; ${OWNER_SESSION_COOKIE}=bad`]) {
      for (const path of ["", query("one-published"), query("one-draft")]) await rejected(await read(path, invalid), 401, "UNAUTHENTICATED");
    }
    for (const change of [{ expiresAt: new Date(0) }, { expiresAt: issued.expiresAt, revokedAt: new Date() }]) {
      await db.ownerSession.update({ where: { tokenHash: hash }, data: change });
      await rejected(await read(query("one-published"), cookie), 401, "UNAUTHENTICATED");
      await rejected(await read("", cookie), 401, "UNAUTHENTICATED");
    }
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: issued.expiresAt, revokedAt: null } });
  });
  await t.test("当前角色变为管理员后返回 403，恢复业主才可读", async () => {
    await db.user.update({ where: { id: "one" }, data: { role: "admin" } });
    await rejected(await read("", cookie), 403, "FORBIDDEN");
    await rejected(await read(query("one-published"), cookie), 403, "FORBIDDEN");
    await db.user.update({ where: { id: "one" }, data: { role: "owner" } });
    await allowed(await read(query("one-draft"), cookie));
  });
  await t.test("未知/重复/空参数返回 400，无参数固定 mock，显式缺失 demo 不回退", async () => {
    for (const path of ["?unknown=1", "?demandId=", "?demandId=%20%09", "?demandId=a&demandId=a", "?demandId=one-draft&ownerId=one"]) {
      await rejected(await read(path), 400, "VALIDATION_ERROR");
    }
    await allowed(await read(""));
    await rejected(await read(query("demo-demand")), 404, "DEMAND_NOT_FOUND");
  });
  await t.test("撤销公开状态立即变 404，坏需求为 503 且无成功空态", async () => {
    await db.demandOrder.update({ where: { id: "one-published" }, data: { status: "draft" } });
    await rejected(await read(query("one-published")), 404, "DEMAND_NOT_FOUND");
    await allowed(await read(query("one-published"), cookie));
    await db.demandOrder.update({ where: { id: "one-published" }, data: { status: "published", renovationType: "invalid" } });
    await rejected(await read(query("one-published")), 503, "DATABASE_UNAVAILABLE");
  });
});
