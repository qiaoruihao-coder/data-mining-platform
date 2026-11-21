import type { PrismaClient } from "@prisma/client";
import { OwnerAccountProvisionInput, type OwnerAccountProvisionInputDTO } from "@/contracts";
import { hashOwnerPassword } from "@/lib/owner-password";

/** Local maintainer provisioning only: creates a new owner, never claims an existing/demo account. */
export async function createOwnerAccount(input: OwnerAccountProvisionInputDTO, db: PrismaClient) {
  const parsed = OwnerAccountProvisionInput.parse(input);
  const passwordHash = await hashOwnerPassword(parsed.password);
  return db.$transaction(async tx => {
    const account = await tx.user.create({ data: { name: parsed.name, role: "owner" } });
    await tx.ownerCredential.create({ data: { userId: account.id, login: parsed.login, passwordHash } });
    return { userId: account.id, login: parsed.login };
  }, { isolationLevel: "Serializable" });
}
