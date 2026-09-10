import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getAuthContext } from "@/lib/auth/auth";

export async function getCredentialAccount(
  db: Db,
  userId: ObjectId,
): Promise<{ _id?: ObjectId; password?: string } | null> {
  return (await db.collection("account").findOne(
    { userId, providerId: "credential" },
    { projection: { password: 1 } },
  )) as { _id?: ObjectId; password?: string } | null;
}

export async function upsertCredentialPassword(
  db: Db,
  userId: ObjectId,
  newPassword: string,
): Promise<void> {
  const ctx = await getAuthContext();
  const passwordHash = await ctx.password.hash(newPassword);

  const existingAccount = await db.collection("account").findOne(
    { userId, providerId: "credential" },
    { projection: { _id: 1 } },
  );

  if ((existingAccount as { _id?: ObjectId } | null)?._id) {
    await db.collection("account").updateOne(
      { _id: (existingAccount as { _id: ObjectId })._id },
      {
        $set: {
          password: passwordHash,
          updatedAt: new Date(),
        },
      },
    );
    return;
  }

  await ctx.internalAdapter.linkAccount({
    userId: userId.toString(),
    providerId: "credential",
    accountId: userId.toString(),
    password: passwordHash,
  });
}
