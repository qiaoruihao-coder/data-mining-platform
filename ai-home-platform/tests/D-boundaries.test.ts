import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canReadAcrossOwner } from "../scripts/check-boundaries.mjs";

test("匹配需求授权读取器仅供匹配服务端与 D 服务端调用", () => {
  const target = "src/lib/matching-demand.ts";
  for (const file of ["src/lib/match/data.ts", "src/app/api/match/route.ts", "src/lib/d-service.ts", "src/app/api/demand/route.ts"]) {
    assert.equal(canReadAcrossOwner(file, target), true, file);
    assert.equal(canReadAcrossOwner(file, target, true), false, file);
  }
  for (const file of ["src/lib/match.ts", "src/app/owner/matches/[id]/page.tsx", "src/features/b/MatchPage.tsx",
    "src/components/ProviderCard.tsx", "src/lib/quote-engine/read.ts", "src/app/api/quote/route.ts", "src/app/layout.tsx", "src/components/ui/card.tsx"]) {
    assert.equal(canReadAcrossOwner(file, target), false, file);
  }
});

test("扫描器拒绝客户端经匹配加载器间接读取授权基础设施", () => {
  const tempRoot = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(tempRoot, "d-matching-demand-boundaries-"));
  const script = fileURLToPath(new URL("../scripts/check-boundaries.mjs", import.meta.url));
  const put = (file: string, source: string) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, source);
  };
  const scan = () => execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8", stdio: "pipe" });
  try {
    put("src/lib/matching-demand.ts", "export const value = 1;");
    for (const statement of ["import { value } from '@/lib/matching-demand';", "export { value } from '@/lib/matching-demand';",
      "export const load = () => import('@/lib/matching-demand');"]) {
      put("src/features/b/client.tsx", "export {};");
      put("src/lib/match/data.ts", statement);
      assert.match(scan(), /边界检查通过/);
      put("src/features/b/client.tsx", "'use client'; export * from '@/lib/match/data';");
      assert.throws(scan, (error: unknown) => {
        assert.ok(error instanceof Error && "stderr" in error);
        assert.match(String(error.stderr), /src\/lib\/match\/data\.ts -> src\/lib\/matching-demand\.ts/);
        return true;
      });
      put("src/features/b/client.tsx", "export {};");
      put("src/lib/match/data.ts", `'use client'; ${statement}`);
      assert.throws(scan);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(root)), tempRoot);
    assert.ok(path.basename(root).startsWith("d-matching-demand-boundaries-"));
    rmSync(root, { recursive: true, force: true });
  }
});

test("匹配服务端可读取服务方目录，客户端可达路径与其他业务不能读取", () => {
  const target = "src/lib/provider-directory.ts";
  for (const file of [
    "src/lib/match/provider-data.ts", "src/app/api/match/route.ts",
    "src/app/api/match/rank/route.ts", "src/app/api/provider/route.ts", "src/lib/d-directory-service.ts",
  ]) {
    assert.equal(canReadAcrossOwner(file, target), true, file);
    assert.equal(canReadAcrossOwner(file, target, true), false, `客户端可达：${file}`);
  }
  for (const file of [
    "src/lib/match.ts", "src/app/owner/matches/[id]/page.tsx", "src/components/ProviderCard.tsx",
    "src/features/b/provider-data.ts", "src/app/api/quote/route.ts", "src/lib/quote-engine/compare.ts",
    "src/features/c/provider-data.ts", "src/components/ui/ProviderDirectory.tsx", "src/app/layout.tsx",
  ]) {
    assert.equal(canReadAcrossOwner(file, target), false, file);
    assert.equal(canReadAcrossOwner(file, target, true), false, `客户端可达：${file}`);
  }
});

test("扫描器允许服务端读取目录，并拒绝客户端直接或间接导入、重导出和动态导入", () => {
  const root = mkdtempSync(path.join(tmpdir(), "d-match-directory-boundaries-"));
  const script = fileURLToPath(new URL("../scripts/check-boundaries.mjs", import.meta.url));
  const put = (file: string, source: string) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  };
  const scan = () => execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8", stdio: "pipe" });
  const rejected = () => assert.throws(scan, (error: unknown) => {
    assert.ok(error instanceof Error && "stderr" in error);
    assert.match(String(error.stderr), / -> src\/lib\/provider-directory\.ts/);
    return true;
  });
  try {
    put("src/lib/provider-directory.ts", "export const value = 1;");
    const client = "src/features/b/client.tsx";
    for (const bridge of ["src/lib/match/provider-data.ts", "src/app/api/match/provider-data.ts", "src/lib/mock-data.ts"]) {
      const specifier = `@/${bridge.slice(4, -3)}`;
      for (const statement of [
        "import { value } from '@/lib/provider-directory';",
        "export { value } from '@/lib/provider-directory';",
        "export const load = () => import('@/lib/provider-directory');",
      ]) {
        put(client, "export {};");
        put(bridge, statement);
        assert.match(scan(), /边界检查通过/);
        put(client, `'use client'; export * from '${specifier}';`);
        rejected();
        put(client, `'use client'; export const load = () => import('${specifier}');`);
        rejected();
        put(client, "export {};");
        put(bridge, `'use client'; ${statement}`);
        rejected();
        put(bridge, "export {};");
        put(client, `'use client'; ${statement}`);
        rejected();
      }
      put(bridge, "export {};");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("报价服务端 API 和引擎可以读取服务端身份基础设施", () => {
  for (const file of [
    "src/app/api/quote/route.ts",
    "src/lib/quote-engine.ts",
    "src/lib/quote-engine/submit-request.ts",
  ]) {
    assert.equal(canReadAcrossOwner(file, "src/lib/server-auth.ts"), true, file);
  }
});

const quoteInfrastructure = ["src/lib/idempotency.ts", "src/lib/quote-policy.ts", "src/lib/server-auth.ts"];

test("会话内部实现只由 D 服务端读取，报价通过 server-auth 使用适配器", () => {
  for (const target of ["src/lib/demo-provider-session.ts", "src/lib/demo-session-handlers.ts", "src/lib/owner-auth.ts"]) {
    assert.equal(canReadAcrossOwner("src/lib/server-auth.ts", target), true);
    assert.equal(canReadAcrossOwner("src/app/api/auth/demo-provider/route.ts", target), true);
    assert.equal(canReadAcrossOwner("src/lib/server-auth.ts", target, true), false);
    for (const file of ["src/components/ui/DemoProviderLogin.tsx", "src/features/c/quote-submit.ts", "src/lib/quote-engine/transaction.ts"]) {
      assert.equal(canReadAcrossOwner(file, target), false);
    }
  }
});

test("报价服务端可导入幂等与授权工具，其他业务和共享 UI 不获得同样权限", () => {
  for (const target of quoteInfrastructure) {
    for (const file of ["src/app/api/quote/route.ts", "src/lib/quote-engine.ts", "src/lib/quote-engine/transaction.ts", "src/lib/d-quote-service.ts"]) {
      assert.equal(canReadAcrossOwner(file, target), true, `${file} -> ${target}`);
      assert.equal(canReadAcrossOwner(file, target, true), false, `客户端可达：${file} -> ${target}`);
    }
    for (const file of [
      "src/app/owner/quotes/[id]/page.tsx", "src/components/QuoteTable.tsx",
      "src/features/b/load-quotes.ts", "src/features/c/quote-submit.ts",
      "src/app/api/match/route.ts", "src/lib/match/data.ts",
      "src/components/ui/button.tsx", "src/app/layout.tsx", "src/lib/quote-engine.private.ts",
    ]) assert.equal(canReadAcrossOwner(file, target), false, `${file} -> ${target}`);
  }
});

test("扫描器拦截客户端经导入、重导出和动态导入间接访问报价服务端工具", () => {
  const root = mkdtempSync(path.join(tmpdir(), "d-quote-boundaries-"));
  const script = fileURLToPath(new URL("../scripts/check-boundaries.mjs", import.meta.url));
  const put = (file: string, source: string) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  };
  const scan = () => execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8", stdio: "pipe" });
  try {
    for (const target of quoteInfrastructure) put(target, "export const value = 1;");
    const client = "src/features/b/client.tsx";
    const bridge = "src/lib/quote-engine/bridge.ts";
    for (const target of quoteInfrastructure) {
      const specifier = `@/${target.slice(4, -3)}`;
      for (const statement of [
        `import { value } from '${specifier}';`,
        `export { value } from '${specifier}';`,
        `export const load = () => import('${specifier}');`,
      ]) {
        put(client, "export {};");
        put(bridge, statement);
        assert.match(scan(), /边界检查通过/);
        put(client, "'use client'; export { value } from '@/lib/quote-engine/bridge';");
        assert.throws(scan, (error: unknown) => {
          assert.ok(error instanceof Error && "stderr" in error);
          assert.match(String(error.stderr), new RegExp(`bridge\\.ts -> ${target.replaceAll(".", "\\.")}`));
          return true;
        });
        put(client, "export {};");
        put(bridge, `'use client'; ${statement}`);
        assert.throws(scan);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("页面、组件和其他业务路径不能读取服务端身份基础设施", () => {
  for (const file of [
    "src/app/owner/quotes/[id]/page.tsx",
    "src/features/b/load-quotes.ts",
    "src/app/owner/demand/chat/page.tsx",
  ]) {
    assert.equal(canReadAcrossOwner(file, "src/lib/server-auth.ts"), false, file);
  }
});
