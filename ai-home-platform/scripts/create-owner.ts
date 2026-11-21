import { emitKeypressEvents, createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { OwnerAccountProvisionInput } from "../src/contracts";
import { createOwnerAccount } from "../src/lib/owner-account";

function hidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    let value = "";
    const raw = stdin.isRaw;
    const finish = (error?: Error) => {
      stdin.off("keypress", keypress);
      stdin.setRawMode(raw);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const keypress = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === "c") return finish(new Error("Cancelled"));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") { value = [...value].slice(0, -1).join(""); return; }
      if (text && !key.ctrl && !key.meta) value += text;
      if (value.length > 1024) finish(new Error("Input too long"));
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.on("keypress", keypress);
    stdin.resume();
  });
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY || process.argv.length > 2) {
    throw new Error("Interactive terminal required");
  }
  loadEnvConfig(process.cwd());
  const terminal = createInterface({ input: stdin, output: stdout });
  const ask = (prompt: string) => new Promise<string>(resolve => terminal.question(prompt, resolve));
  const login = await ask("登录账号（3–64 位字母/数字/._-）：");
  const name = await ask("显示名称：");
  terminal.close();
  const password = await hidden("密码（15–128 字符，输入不显示）：");
  const confirmation = await hidden("再次输入密码：");
  if (password !== confirmation) throw new Error("Passwords differ");
  const input = OwnerAccountProvisionInput.parse({ login, name, password });
  const db = new PrismaClient();
  try {
    const account = await createOwnerAccount(input, db);
    stdout.write(`业主账号已开通：${account.login}。请通过安全方式交付密码，不要发送到代码仓库。\n`);
  } finally { await db.$disconnect(); }
}

main().catch(() => {
  // Prisma/Zod errors may contain submitted fields: never print the caught error.
  console.error("未开通账号。请检查交互终端、输入格式、两次密码、账号是否重复，以及数据库是否已同步。");
  process.exitCode = 1;
});
