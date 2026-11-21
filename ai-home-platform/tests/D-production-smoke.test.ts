import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProductionSmoke } from '../scripts/run-production-smoke.mjs';

// These are synthetic HTTP/CLI fixtures; the real Next build is exercised separately by CI.
function fixture(t: TestContext, serverMode = 'ready', smokeMode = 'pass') {
 const cwd = mkdtempSync(join(tmpdir(), 'd-production-smoke-'));
 mkdirSync(join(cwd, 'node_modules/next/dist/bin'), { recursive: true });
 mkdirSync(join(cwd, 'scripts'));
 writeFileSync(join(cwd, 'node_modules/next/dist/bin/next'), `
 const { createServer } = require('node:http');
 const { writeFileSync } = require('node:fs');
 const assert = require('node:assert/strict');
 writeFileSync('server.pid', String(process.pid));
 assert.equal(process.argv[2], 'start');
 assert.equal(process.argv[3], '--hostname');
 assert.equal(process.argv[4], '127.0.0.1');
 assert.equal(process.env.AI_MODE, 'mock');
 assert.equal(process.env.NODE_ENV, 'production');
 const mode = process.env.FIXTURE_SERVER;
 if (mode === 'exit') process.exit(17);
 if (mode === 'stubborn') process.on('SIGTERM', () => {});
 const server = createServer((req, res) => {
  if (req.url === '/exit') process.exit(0);
  if (mode === 'hang') return;
  res.writeHead(mode === 'unhealthy' ? 503 : 200).end('fixture');
 });
 server.listen(Number(process.argv[6]), process.argv[4], () => {
  writeFileSync('server.url', 'http://127.0.0.1:' + server.address().port);
 });
 `);
 writeFileSync(join(cwd, 'scripts/smoke.mjs'), `
 import assert from 'node:assert/strict';
 import { readFileSync, writeFileSync } from 'node:fs';
 writeFileSync('smoke.pid', String(process.pid));
 assert.equal(process.env.SMOKE_BASE_URL, readFileSync('server.url', 'utf8'));
 assert.equal(new URL(process.env.SMOKE_BASE_URL).hostname, '127.0.0.1');
 assert.equal(process.env.AI_MODE, 'mock');
 assert.equal(process.env.NODE_ENV, 'production');
 const response = await fetch(process.env.SMOKE_BASE_URL + '/api/health');
 assert.equal(response.status, 200);
 await response.text();
 writeFileSync('smoke.started', 'true');
 const mode = process.env.FIXTURE_SMOKE;
 if (mode === 'fail') process.exit(23);
 if (mode === 'server-exit') await fetch(process.env.SMOKE_BASE_URL + '/exit').catch(() => {});
 if (mode === 'hang' || mode === 'server-exit') setInterval(() => {}, 1000);
 else writeFileSync('smoke.passed', 'true');
 `);
 t.after(() => {
  // Fallback for a failed assertion; only PIDs recorded by this fixture are eligible.
  for (const name of ['smoke', 'server']) {
   const file = join(cwd, `${name}.pid`);
   if (existsSync(file)) {
    try { process.kill(Number(readFileSync(file, 'utf8')), 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
   }
  }
  rmSync(cwd, { recursive: true, force: true });
 });
 return {
  cwd, startupTimeoutMs: 10000, smokeTimeoutMs: 10000,
  env: { ...process.env, DATABASE_URL: 'file:./synthetic.db', AI_MODE: 'live',
   NODE_ENV: 'development' as const, SMOKE_BASE_URL: 'http://127.0.0.1:1',
   FIXTURE_SERVER: serverMode, FIXTURE_SMOKE: smokeMode },
 };
}

async function waitForFile(path: string) {
 const deadline = Date.now() + 10000;
 while (!existsSync(path)) {
  assert.ok(Date.now() < deadline, `Fixture did not create ${path}`);
  await delay(25);
 }
}

async function assertStopped(cwd: string) {
 for (const name of ['server', 'smoke']) {
  const file = join(cwd, `${name}.pid`);
  if (existsSync(file)) {
   const pid = Number(readFileSync(file, 'utf8'));
   assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `${name} must exit`);
  }
 }
 if (existsSync(join(cwd, 'server.url'))) {
  await assert.rejects(fetch(readFileSync(join(cwd, 'server.url'), 'utf8'), { signal: AbortSignal.timeout(1000) }));
 }
}

test('生产冒烟使用独立 loopback 服务、强制 mock 并保留其他服务', async t => {
 const options = fixture(t);
 const unrelated = createServer((_, res) => res.end('unrelated'));
 await new Promise<void>(resolve => unrelated.listen(0, '127.0.0.1', resolve));
 t.after(() => new Promise<void>((resolve, reject) => {
  unrelated.close(error => error ? reject(error) : resolve());
  unrelated.closeAllConnections();
 }));
 const address = unrelated.address();
 assert.ok(address && typeof address !== 'string');
 await runProductionSmoke(options);
 assert.equal(existsSync(join(options.cwd, 'smoke.passed')), true);
 await assertStopped(options.cwd);
 const response = await fetch(`http://127.0.0.1:${address.port}`);
 assert.equal(await response.text(), 'unrelated');
});

test('生产启动退出时失败，不能执行冒烟', async t => {
 const options = fixture(t, 'exit');
 await assert.rejects(runProductionSmoke(options), /Production server exited unexpectedly: exit code 17/);
 assert.equal(existsSync(join(options.cwd, 'smoke.pid')), false);
 await assertStopped(options.cwd);
});

for (const mode of ['unhealthy', 'hang']) {
 test(`生产健康检查 ${mode} 时超时失败并停止服务`, async t => {
  const options = fixture(t, mode);
  await assert.rejects(runProductionSmoke({ ...options, startupTimeoutMs: 2000 }), /Production startup timed out/);
  assert.equal(existsSync(join(options.cwd, 'server.url')), true);
  assert.equal(existsSync(join(options.cwd, 'smoke.pid')), false);
  await assertStopped(options.cwd);
 });
}

test('HTTP 冒烟非零退出使任务失败并清理服务', async t => {
 const options = fixture(t, 'ready', 'fail');
 await assert.rejects(runProductionSmoke(options), /HTTP smoke failed: exit code 23/);
 await assertStopped(options.cwd);
});

test('HTTP 冒烟卡住时超时并清理两个子进程', async t => {
 const options = fixture(t, 'ready', 'hang');
 await assert.rejects(runProductionSmoke({ ...options, smokeTimeoutMs: 2000 }), /HTTP smoke timed out/);
 assert.equal(existsSync(join(options.cwd, 'smoke.started')), true);
 await assertStopped(options.cwd);
});

test('冒烟期间服务即使以 0 退出也失败，并停止卡住的冒烟进程', async t => {
 const options = fixture(t, 'ready', 'server-exit');
 await assert.rejects(runProductionSmoke(options), /Production server exited unexpectedly: exit code 0/);
 await assertStopped(options.cwd);
});

test('取消正在运行的冒烟会清理进程，包括忽略 SIGTERM 的服务', async t => {
 const options = fixture(t, 'stubborn', 'hang');
 const controller = new AbortController();
 const running = assert.rejects(runProductionSmoke({ ...options, signal: controller.signal }), /test cancelled/);
 try { await waitForFile(join(options.cwd, 'smoke.started')); }
 finally { controller.abort(new Error('test cancelled')); }
 await running;
 await assertStopped(options.cwd);
});

test('缺少数据库或已取消时拒绝启动，CLI 返回失败状态', async t => {
 const options = fixture(t);
 await assert.rejects(runProductionSmoke({ ...options, env: { ...options.env, DATABASE_URL: ' ' } }), /Set DATABASE_URL explicitly/);
 await assert.rejects(runProductionSmoke({ ...options, signal: AbortSignal.abort(new Error('already cancelled')) }), /already cancelled/);
 const cli = spawn(process.execPath, [resolve('scripts/run-production-smoke.mjs')], {
  cwd: options.cwd, env: { ...options.env, DATABASE_URL: '' }, stdio: 'pipe', windowsHide: true,
 });
 let stderr = '';
 cli.stderr.on('data', chunk => { stderr += chunk; });
 const code = await new Promise<number | null>((resolve, reject) => {
  cli.once('error', reject); cli.once('exit', resolve);
 });
 assert.equal(code, 1);
 assert.match(stderr, /Set DATABASE_URL explicitly/);
 assert.equal(existsSync(join(options.cwd, 'server.pid')), false);
});
