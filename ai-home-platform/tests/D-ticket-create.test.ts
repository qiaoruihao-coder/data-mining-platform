import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Ticket, TicketCreateInput, TicketQuery, envelope } from "../src/contracts";
import { handleTicketCreate, handleTicketRead } from "../src/lib/ticket";
import { createOwnerAccount } from "../src/lib/owner-account";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";
import { tickets } from "../src/lib/mock-data";

const origin = "https://localhost:3000";
const password = "Synthetic-ticket-create-password-42";
const input = { demandId: "one", description: " 墙面潮湿，申请核实。 ", category: "quality" };
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", body: unknown = input) => new Request(`${origin}/api/ticket`, {
  method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
});
function noCache(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  noCache(response); assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal("data" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private database|tokenHash|ownerId/);
  return body;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(async tx => run(await transform(tx)), options);
  } } as unknown as Database;
}

test("工单公共契约规范描述、保留精确 ID，拒绝身份/状态/责任方和非法分类", () => {
  assert.deepEqual(TicketCreateInput.parse({ ...input, demandId: " one " }), { ...input, demandId: " one ", description: input.description.trim() });
  for (const category of Ticket.shape.category.options) assert.ok(TicketCreateInput.safeParse({ ...input, category }).success);
  assert.ok(TicketCreateInput.safeParse({ ...input, description: "测".repeat(4000) }).success);
  const invalid = [null, {}, { ...input, description: " \n " }, { ...input, description: "x".repeat(4001) },
    { ...input, description: 42 }, { ...input, category: "other" }, { ...input, demandId: " " }, { ...input, demandId: "" }];
  for (const fields of [{ id: "forged" }, { ownerId: "other" }, { role: "admin" }, { status: "resolved" },
    { responsibleProviderId: null }, { responsibleProviderId: "provider-a" }, { source: "live" }, { meta: { source: "mock" } }]) invalid.push({ ...input, ...fields });
  for (const value of invalid) assert.equal(TicketCreateInput.safeParse(value).success, false);
  assert.equal(TicketQuery.safeParse({ demandId: "one", ownerId: "forged" }).success, false);
});

test("工单创建与读取：隔离 SQLite、实际会话及事务回滚", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-ticket-create-"));
  const databasePath = join(fixture, "tickets.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-ticket-create-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const owner = await createOwnerAccount({ login: "ticket-create-one", name: "Synthetic first", password }, db);
  const other = await createOwnerAccount({ login: "ticket-create-two", name: "Synthetic second", password }, db);
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: owner.userId, role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: other.userId, role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  const demands = ["one", "two", "demo-demand", " one "].map(id => ({ id, ownerId: id === "two" ? other.userId : owner.userId,
    description: "Synthetic demand", city: "Test", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000,
    renovationType: "repair", desiredDays: 10, status: "published" }));
  t.beforeEach(async () => {
    await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { userId: owner.userId, revokedAt: null, expiresAt: issued.expiresAt } });
    await db.ticket.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: demands });
  });
  const create = (value: unknown = input, credential = cookie, client: Database = db) => handleTicketCreate(request(credential, value), client);
  const read = (query = "?demandId=one", credential = cookie, client: Database = second) => handleTicketRead(
    new Request(`${origin}/api/ticket${query}`, { headers: { cookie: credential } }), client);

  await t.test("发布后四种状态/四分类可提交，另一连接读到 open/null/live，需求状态不变", async () => {
    for (const [index, status] of ["published", "contracted", "in_progress", "completed"].entries()) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } });
      const response = await create({ ...input, category: Ticket.shape.category.options[index] });
      noCache(response); assert.equal(response.status, 201);
      const body = envelope(Ticket).parse(await response.json());
      assert.deepEqual(body, { ok: true, data: { id: body.data.id, demandId: "one", description: input.description.trim(),
        category: Ticket.shape.category.options[index], status: "open", responsibleProviderId: null }, meta: { source: "live" } });
      const list = await read(); noCache(list); assert.equal(list.status, 200);
      const saved = envelope(Ticket.array()).parse(await list.json()); assert.equal(saved.meta.source, "live");
      assert.deepEqual(saved.data.find(row => row.id === body.data.id), body.data);
      assert.equal(saved.data.length, index + 1);
      assert.deepEqual(saved.data.map(row => row.id), saved.data.map(row => row.id).sort());
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).status, status);
    }
  });

  await t.test("空列表仅属于已验证本人需求；精确空格 ID 与普通 ID 分离", async () => {
    await create();
    const empty = await read("?demandId=%20one%20"); assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { ok: true, data: [], meta: { source: "live" } });
    await create({ ...input, demandId: " one " });
    const exact = await (await read("?demandId=%20one%20")).json();
    assert.equal(exact.data.length, 1); assert.equal(exact.data[0].demandId, " one ");
    await db.demandOrder.update({ where: { id: " one " }, data: { status: "draft" } });
    assert.equal((await read("?demandId=%20one%20")).status, 200);
  });

  await t.test("同源和身份预检先于正文；匿名、坏 cookie、重复 cookie 和仅服务方都拒绝", async () => {
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`, "ai_home_demo_session=synthetic-provider"]) {
      const req = request(credential); await denied(await handleTicketCreate(req, db), 401, "UNAUTHENTICATED"); assert.equal(req.bodyUsed, false);
      await denied(await read("?demandId=one", credential), 401, "UNAUTHENTICATED");
    }
    const forbiddenHeaders: Record<string, string>[] = [{}, { origin: "https://other.example" }, { origin, "sec-fetch-site": "cross-site" }];
    for (const header of forbiddenHeaders) {
      const req = new Request(`${origin}/api/ticket`, { method: "POST", headers: { cookie, ...header }, body: "{}" });
      await denied(await handleTicketCreate(req, db), 403, "FORBIDDEN"); assert.equal(req.bodyUsed, false);
    }
    assert.equal(await db.ticket.count(), 0);
  });

  await t.test("过期/撤销/角色改变不能访问真实工单或固定演示入口，双 cookie 不回退", async () => {
    for (const data of [{ expiresAt: new Date(0) }, { expiresAt: issued.expiresAt, revokedAt: new Date() }]) {
      await db.ownerSession.update({ where: { tokenHash: hash }, data });
      await denied(await create(input, `${cookie}; ai_home_demo_session=synthetic-provider`), 401, "UNAUTHENTICATED");
      for (const query of ["", "?demandId=demo-demand", "?demandId=one"]) await denied(await read(query), 401, "UNAUTHENTICATED");
    }
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: owner.userId }, data: { role } });
      await denied(await create(), 403, "FORBIDDEN");
      for (const query of ["", "?demandId=demo-demand", "?demandId=one"]) await denied(await read(query), 403, "FORBIDDEN");
    }
    assert.equal(await db.ticket.count(), 0);
  });

  await t.test("他人和不存在统一 404；演示只读，draft/未知状态拒绝创建", async () => {
    const missing = await denied(await create({ ...input, demandId: "missing" }), 404, "DEMAND_NOT_FOUND");
    for (const id of ["two", "missing"]) {
      assert.deepEqual(await denied(await create({ ...input, demandId: id }), 404, "DEMAND_NOT_FOUND"), missing);
      assert.deepEqual(await denied(await read(`?demandId=${id}`), 404, "DEMAND_NOT_FOUND"), missing);
    }
    await denied(await create(input, otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await create({ ...input, demandId: "demo-demand" }, otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await create({ ...input, demandId: "demo-demand" }), 409, "DEMO_DEMAND_READ_ONLY");
    for (const status of ["draft", "unknown"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } }); await denied(await create(), 409, "INVALID_STATE");
    }
    assert.equal(await db.ticket.count(), 0);
  });

  await t.test("无参数与精确 demo-demand 只读固定 mock，不暴露可变库记录", async () => {
    await create();
    await db.ticket.create({ data: { id: "private-demo", demandId: "demo-demand", description: "Private database content", category: "quality" } });
    for (const query of ["", "?demandId=demo-demand"]) {
      for (const credential of ["", cookie, otherCookie]) {
        const response = await read(query, credential); noCache(response); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, data: tickets, meta: { source: "mock" } });
      }
      for (const credential of [`${OWNER_SESSION_COOKIE}=invalid`, `${cookie}; ${cookie}`]) {
        await denied(await read(query, credential), 401, "UNAUTHENTICATED");
      }
    }
    await denied(await read("?demandId=%20demo-demand%20"), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("查询拒绝未知/重复/身份/空参数；坏 JSON、超大 UTF-8 正文及非法输入不写库", async () => {
    for (const query of ["?demandId=", "?demandId=%20", "?demandId=one&demandId=two", "?ownerId=one", "?demandId=one&status=open", "?unknown="]) {
      await denied(await read(query, ""), 400, "VALIDATION_ERROR");
      await denied(await handleTicketCreate(new Request(`${origin}/api/ticket${query}`, { method: "POST", headers: { origin, cookie } }), db), 400, "VALIDATION_ERROR");
    }
    for (const body of [undefined, "{"]) {
      await denied(await handleTicketCreate(new Request(`${origin}/api/ticket`, { method: "POST", headers: { origin, cookie }, body }), db), 400, "INVALID_JSON");
    }
    for (const value of [{ ...input, status: "resolved" }, { ...input, description: " " }, { ...input, huge: "测".repeat(6000) }]) {
      await denied(await create(value), 400, "VALIDATION_ERROR");
    }
    assert.equal(await db.ticket.count(), 0);
  });

  await t.test("写事务重验会话/角色/归属/状态；与预检身份不同时拒绝", async () => {
    const changes: [number, string, (tx: Prisma.TransactionClient) => Promise<unknown>][] = [
      [401, "UNAUTHENTICATED", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })],
      [403, "FORBIDDEN", tx => tx.user.update({ where: { id: owner.userId }, data: { role: "admin" } })],
      [403, "FORBIDDEN", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { userId: other.userId } })],
      [404, "DEMAND_NOT_FOUND", tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } })],
      [409, "INVALID_STATE", tx => tx.demandOrder.update({ where: { id: "one" }, data: { status: "draft" } })],
    ];
    for (const [status, code, change] of changes) {
      let transactions = 0;
      const client = decorate(db, async tx => { if (++transactions === 2) await change(tx); return tx; });
      await denied(await create(input, cookie, client), status, code);
      assert.equal(transactions, 2); assert.equal(await db.ticket.count(), 0);
      const session = await db.ownerSession.findUniqueOrThrow({ where: { tokenHash: hash } });
      assert.equal(session.revokedAt, null); assert.equal(session.userId, owner.userId);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).role, "owner");
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).ownerId, owner.userId);
    }
  });

  await t.test("最终 SQL 限制归属和当前状态，写入后输出损坏时整笔回滚", async () => {
    for (const data of [{ ownerId: other.userId }, { status: "draft" }]) {
      const client = decorate(db, async tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        update: async (args: Prisma.DemandOrderUpdateArgs) => { await tx.demandOrder.update({ where: { id: "one" }, data }); return tx.demandOrder.update(args); },
      } }) as unknown as Prisma.TransactionClient);
      await denied(await create(input, cookie, client), 503, "TICKET_UNAVAILABLE"); assert.equal(await db.ticket.count(), 0);
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).ownerId, owner.userId);
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).status, "published");
    }
    for (const change of [{ id: "wrong" }, { demandId: "two" }, { category: "invalid" }, { status: "resolved" },
      { responsibleProviderId: "provider-a" }, { description: "wrong" }]) {
      const client = decorate(db, async tx => ({ ...tx, ticket: { ...tx.ticket,
        findUniqueOrThrow: async (args: Prisma.TicketFindUniqueOrThrowArgs) => ({ ...await tx.ticket.findUniqueOrThrow(args), ...change }),
      } }) as unknown as Prisma.TransactionClient);
      await denied(await create(input, cookie, client), 503, "TICKET_UNAVAILABLE"); assert.equal(await db.ticket.count(), 0);
    }
  });

  await t.test("读取实际 SQL 限制需求与业主；会话变化/返回越界/坏 DTO/数据库异常不降级成功", async () => {
    await create();
    let transactions = 0;
    const scoped = decorate(db, async tx => { transactions++; return { ...tx, ticket: { ...tx.ticket,
      findMany: async (args: Prisma.TicketFindManyArgs) => {
        assert.deepEqual(args.where, { demandId: "one", demand: { ownerId: owner.userId } });
        return tx.ticket.findMany(args);
      },
    } } as unknown as Prisma.TransactionClient; });
    assert.equal((await read("?demandId=one", cookie, scoped)).status, 200); assert.equal(transactions, 1);
    const revoked = decorate(db, async tx => { await tx.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } }); return tx; });
    await denied(await read("?demandId=one", cookie, revoked), 401, "UNAUTHENTICATED");
    for (const change of [{ demandId: "two" }, { category: "bad" }, { status: "closed" }]) {
      const client = decorate(db, async tx => ({ ...tx, ticket: { ...tx.ticket,
        findMany: async (args: Prisma.TicketFindManyArgs) => (await tx.ticket.findMany(args)).map(row => ({ ...row, ...change })),
      } }) as unknown as Prisma.TransactionClient);
      await denied(await read("?demandId=one", cookie, client), 503, "TICKET_UNAVAILABLE");
    }
    const broken = { $transaction: () => { throw new Error("private database tokenHash"); } } as unknown as Database;
    await denied(await create(input, cookie, broken), 503, "TICKET_UNAVAILABLE");
    await denied(await read("?demandId=one", cookie, broken), 503, "TICKET_UNAVAILABLE");
  });

  await t.test("重复提交产生独立 ID，不覆盖既有报告；另一业主仍不可读取", async () => {
    const first = await (await create()).json(); const next = await (await create()).json();
    assert.notEqual(first.data.id, next.data.id); assert.equal(await db.ticket.count(), 2);
    assert.deepEqual(await second.ticket.findUnique({ where: { id: first.data.id } }), first.data);
    await denied(await read("?demandId=one", otherCookie), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("公开密码登录 → 创建需求 → 工单 201/live → GET；跨业主与退出后的读写拒绝", () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    const script = join(fixture, "public-ticket.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { POST as login, DELETE as logout } from ${modulePath("src/app/api/auth/owner/route.ts")};
      import { POST as demand } from ${modulePath("src/app/api/demand/route.ts")};
      import { POST, GET } from ${modulePath("src/app/api/ticket/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const req = (path, method = 'GET', cookie = '', body) => new Request('${origin}' + path, { method,
        headers: { origin: '${origin}', cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      async function main() {
        const signIn = async loginName => {
          const response = await login(req('/api/auth/owner', 'POST', '', { login: loginName, password: ${JSON.stringify(password)} }));
          assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
        };
        const cookie = await signIn('ticket-create-one');
        const created = await demand(req('/api/demand', 'POST', cookie, { description: 'Synthetic', city: 'Test', areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000, renovationType: 'repair', desiredDays: 10 }));
        assert.equal(created.status, 201); const id = (await created.json()).data.id;
        const input = { ...${JSON.stringify(input)}, demandId: id };
        const response = await POST(req('/api/ticket', 'POST', cookie, input));
        assert.equal(response.status, 201); const saved = await response.json(); assert.equal(saved.meta.source, 'live');
        const list = await GET(req('/api/ticket?demandId=' + id, 'GET', cookie)); assert.equal(list.status, 200);
        assert.deepEqual(await list.json(), { ok: true, data: [saved.data], meta: { source: 'live' } });
        const foreign = await signIn('ticket-create-two');
        assert.equal((await POST(req('/api/ticket', 'POST', foreign, input))).status, 404);
        assert.equal((await GET(req('/api/ticket?demandId=' + id, 'GET', foreign))).status, 404);
        assert.equal((await logout(req('/api/auth/owner', 'DELETE', cookie))).status, 200);
        assert.equal((await POST(req('/api/ticket', 'POST', cookie, input))).status, 401);
        assert.equal((await GET(req('/api/ticket?demandId=' + id, 'GET', cookie))).status, 401);
        assert.equal(await prisma.ticket.count({ where: { demandId: id } }), 1);
        console.log('public-ticket-create-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-ticket-create-ok/);
  });
});
