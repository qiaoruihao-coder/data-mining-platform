import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

async function freePort() {
 const reservation = createServer();
 await new Promise((resolve, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', resolve);
 });
 const port = reservation.address().port;
 await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
 return port;
}

function startChild(args, cwd, env) {
 // Invoke Node directly: no npm/shell wrapper to leave a server running after cleanup.
 const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
 const tracked = { child, exited: false, done: null };
 tracked.done = new Promise(resolve => {
  child.once('error', error => { tracked.exited = true; resolve(error.message); });
  child.once('exit', (code, signal) => {
   tracked.exited = true;
   resolve(code === 0 ? null : `exit code ${code}, signal ${signal ?? 'none'}`);
  });
 });
 return tracked;
}

async function stopChild(tracked) {
 if (!tracked || tracked.exited) return;
 tracked.child.kill('SIGTERM');
 const force = setTimeout(() => tracked.child.kill('SIGKILL'), 2000);
 try { await tracked.done; }
 finally { clearTimeout(force); }
}

async function runPhase(task, server, signal, timeoutMs, label) {
 const deadline = new AbortController();
 const phaseSignal = AbortSignal.any([deadline.signal, ...(signal ? [signal] : [])]);
 const timer = setTimeout(() => deadline.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
 let onAbort;
 const aborted = new Promise((_, reject) => {
  onAbort = () => reject(phaseSignal.reason);
  phaseSignal.addEventListener('abort', onAbort, { once: true });
  if (phaseSignal.aborted) onAbort();
 });
 try {
  phaseSignal.throwIfAborted();
  return await Promise.race([
   task(phaseSignal), aborted,
   server.done.then(result => { throw new Error(`Production server exited unexpectedly: ${result ?? 'exit code 0'}`); }),
  ]);
 } finally {
  clearTimeout(timer);
  phaseSignal.removeEventListener('abort', onAbort);
  deadline.abort();
 }
}

/**
 * Run against the production build in cwd. DATABASE_URL must identify a seeded test database.
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, startupTimeoutMs?: number,
 * smokeTimeoutMs?: number, signal?: AbortSignal}} [options]
 */
export async function runProductionSmoke({
 cwd = process.cwd(), env = process.env, startupTimeoutMs = 30000,
 smokeTimeoutMs = 90000, signal,
} = {}) {
 if (!env.DATABASE_URL?.trim()) throw new Error('Set DATABASE_URL explicitly to a seeded test database before running production smoke.');
 for (const timeout of [startupTimeoutMs, smokeTimeoutMs]) {
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('Smoke timeouts must be positive timer-safe integers.');
 }
 signal?.throwIfAborted();
 const port = await freePort();
 signal?.throwIfAborted();
 const base = `http://127.0.0.1:${port}`;
 const childEnv = { ...env, AI_MODE: 'mock', DEMO_AUTH_ENABLED: 'true', NODE_ENV: 'production', SMOKE_BASE_URL: base };
 let server;
 let smoke;
 try {
  console.log(`Starting production smoke at ${base} (AI_MODE=mock, DEMO_AUTH_ENABLED=true in test children).`);
  server = startChild([resolve(cwd, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], cwd, childEnv);
  await runPhase(async phaseSignal => {
   while (true) {
    phaseSignal.throwIfAborted();
    try {
     const response = await fetch(`${base}/api/health`, {
      signal: AbortSignal.any([phaseSignal, AbortSignal.timeout(1000)]), redirect: 'error',
     });
     await response.body?.cancel();
     if (response.status === 200) return;
    } catch { phaseSignal.throwIfAborted(); }
    await delay(100, undefined, { signal: phaseSignal });
   }
  }, server, signal, startupTimeoutMs, 'Production startup');
  await runPhase(async phaseSignal => {
   phaseSignal.throwIfAborted();
   smoke = startChild([resolve(cwd, 'scripts/smoke.mjs')], cwd, childEnv);
   const result = await smoke.done;
   if (result !== null) throw new Error(`HTTP smoke failed: ${result}`);
  }, server, signal, smokeTimeoutMs, 'HTTP smoke');
 } finally {
  try { await stopChild(smoke); }
  finally { await stopChild(server); }
 }
 console.log('Production HTTP smoke passed; child processes stopped.');
}

async function main() {
 const controller = new AbortController();
 const interrupt = () => controller.abort(new Error('Production smoke interrupted.'));
 process.once('SIGINT', interrupt);
 process.once('SIGTERM', interrupt);
 try { await runProductionSmoke({ signal: controller.signal }); }
 catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
 } finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
 }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main();
