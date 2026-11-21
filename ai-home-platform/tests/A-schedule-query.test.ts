import assert from "node:assert/strict";
import test from "node:test";
import { Schedule } from "../src/contracts";
import { loadSchedule, parseScheduleVersion } from "../src/features/a/schedule-query";

// 仅用于测试的排期，不向页面注入本地演示数据。
const schedule = Schedule.parse({ demandId: "test-demand", version: 7, tasks: [] });
const ok = (data: unknown = schedule, source = "live") => ({ ok: true, data, meta: { source } });

test("版本输入仅接受公共契约范围内的十进制正整数", () => {
  for (const input of ["", " ", "0", "-1", "1.5", "1e2", "0x10", "Infinity", "2147483648"]) {
    assert.equal(parseScheduleVersion(input), null, input);
  }
  assert.equal(parseScheduleVersion(" 007 "), 7);
  assert.equal(parseScheduleVersion("2147483647"), 2147483647);
});

test("指定版本使用编码后的需求 ID 查询，返回最新时省略 version", async (t) => {
  const id = "需求/a?&#";
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (path: string) => {
    paths.push(path);
    return Response.json(ok({ ...schedule, demandId: id }));
  });
  assert.equal((await loadSchedule(id, 7)).data?.version, 7);
  assert.equal((await loadSchedule(id)).phase, "ready");
  assert.deepEqual(paths, [`/api/schedule?demandId=${encodeURIComponent(id)}&version=7`, `/api/schedule?demandId=${encodeURIComponent(id)}`]);
});

test("非法数值版本不请求接口，指定版本响应错位时拒绝展示", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json(ok()));
  for (const version of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
    assert.equal((await loadSchedule(schedule.demandId, version)).phase, "failed");
  }
  assert.equal(request.mock.callCount(), 0);
  const result = await loadSchedule(schedule.demandId, 6);
  assert.equal(result.phase, "failed");
  assert.equal(result.data, null);
  assert.match(result.error!, /版本.*不一致/);
  assert.equal(request.mock.callCount(), 1);
});

test("指定版本不存在或服务失败时不回退到最新版本", async (t) => {
  for (const status of [404, 501, 503]) {
    const request = t.mock.method(globalThis, "fetch", async (path: string) => {
      assert.equal(path, "/api/schedule?demandId=test-demand&version=2");
      return Response.json({ ok: false, error: { code: status === 404 ? "SCHEDULE_NOT_FOUND" : "TEST_ERROR", message: "测试错误" } }, { status });
    });
    const result = await loadSchedule(schedule.demandId, 2);
    assert.equal(result.phase, status === 404 ? "missing" : "failed");
    assert.equal(result.data, null);
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("按需求查询最新排期，保留服务端版本和 mock/live 来源", async (t) => {
  for (const source of ["mock", "live"] as const) {
    const request = t.mock.method(globalThis, "fetch", async (path: string) => {
      assert.equal(path, "/api/schedule?demandId=test-demand");
      return Response.json(ok(schedule, source));
    });
    assert.deepEqual(await loadSchedule(schedule.demandId), { phase: "ready", data: schedule, source, error: null });
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("空需求编号不发请求，特殊字符编码后不会混入其他查询参数", async (t) => {
  const id = "需求/a?version=2&#";
  const request = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, `/api/schedule?demandId=${encodeURIComponent(id)}`);
    return Response.json(ok({ ...schedule, demandId: id }));
  });
  for (const invalid of ["", "  "]) assert.equal((await loadSchedule(invalid)).phase, "failed");
  assert.equal(request.mock.callCount(), 0);
  assert.equal((await loadSchedule(id)).phase, "ready");
  assert.equal(request.mock.callCount(), 1);
});

test("只有约定的 404 SCHEDULE_NOT_FOUND 显示暂无排期，不回退演示入口", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json(
    { ok: false, error: { code: "SCHEDULE_NOT_FOUND", message: "没有对应排期版本" } }, { status: 404 },
  ));
  assert.deepEqual(await loadSchedule(schedule.demandId), { phase: "missing", data: null, source: null, error: null });
  assert.equal(request.mock.callCount(), 1);
});

test("400/401/403/503 和未约定的 404 保持失败，不断言没有排期", async (t) => {
  for (const status of [400, 401, 403, 404, 503]) {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json(
      { ok: false, error: { code: "TEST_FAILURE", message: "测试错误" } }, { status },
    ));
    const result = await loadSchedule(schedule.demandId);
    assert.equal(result.phase, "failed");
    assert.equal(result.data, null);
    assert.equal(result.source, null);
    assert.match(result.error!, new RegExp(`HTTP ${status}`));
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("501 即使带成功信封或非法 JSON 也不是成功", async (t) => {
  for (const response of [Response.json(ok(), { status: 501 }), new Response("not json", { status: 501 })]) {
    const request = t.mock.method(globalThis, "fetch", async () => response);
    const result = await loadSchedule(schedule.demandId);
    assert.equal(result.phase, "failed");
    assert.equal(result.data, null);
    assert.match(result.error!, /尚未开放.*501/);
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("错位需求、无效工序、缺失来源和错误信封不展示为排期", async (t) => {
  for (const payload of [
    ok({ ...schedule, demandId: "other-demand" }), ok({ ...schedule, tasks: [{}] }),
    { ok: true, data: schedule }, ok(schedule, "unknown"),
    { ok: false, error: { code: "SCHEDULE_NOT_FOUND", message: "失败" } },
  ]) {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    const result = await loadSchedule(schedule.demandId);
    assert.equal(result.phase, "failed");
    assert.equal(result.data, null);
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("网络和响应格式错误可重试，刷新时使用服务端的新版本", async (t) => {
  let attempt = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempt++;
    if (attempt === 1) throw new Error("test offline");
    if (attempt === 2) return new Response("not json");
    return Response.json(ok({ ...schedule, version: attempt }));
  });
  assert.equal((await loadSchedule(schedule.demandId)).phase, "failed");
  assert.equal((await loadSchedule(schedule.demandId)).phase, "failed");
  assert.equal((await loadSchedule(schedule.demandId)).data?.version, 3);
  assert.equal((await loadSchedule(schedule.demandId)).data?.version, 4);
});
