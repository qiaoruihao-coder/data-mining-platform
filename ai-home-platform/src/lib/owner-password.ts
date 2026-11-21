import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { OwnerLoginInput } from "@/contracts";

const prefix = "scrypt$131072$8$1$";
const format = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
// Unknown accounts still incur the same KDF work; this digest never grants an identity.
const dummy = `${prefix}${"0".repeat(32)}$${"0".repeat(128)}`;
let active = 0;

export class PasswordCapacityError extends Error {}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

export async function hashOwnerPassword(password: string) {
  OwnerLoginInput.shape.password.parse(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${prefix}${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyOwnerPassword(password: string, stored: string | null) {
  if (active >= 2) throw new PasswordCapacityError();
  active++;
  try {
    const match = format.exec(stored ?? dummy);
    if (!match) throw new Error("Invalid password digest");
    const key = await derive(password, Buffer.from(match[1], "hex"));
    const equal = timingSafeEqual(key, Buffer.from(match[2], "hex"));
    return stored !== null && equal;
  } finally { active--; }
}
