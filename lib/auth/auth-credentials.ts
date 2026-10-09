import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getAuthContext } from "@/lib/auth/auth";
import { PasswordReset } from "@/models/password-reset.model";

export async function getCredentialAccount(
  db: Db,
  userId: ObjectId,
): Promise<{ _id?: ObjectId; password?: string } | null> {
  return (await db.collection("account").findOne(
    { userId, providerId: "credential" },
    { projection: { password: 1 } },
  )) as { _id?: ObjectId; password?: string } | null;
}

/**
 * Sets the account's password — the one place a reset link, the account page
 * and the shopper app all write it.
 *
 * Every emailed link of the user's stops working once it is set: an older
 * invitation or reset still in the inbox would otherwise set it again, and
 * whoever saw that email would hold a way into the account.
 */
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
  } else {
    await ctx.internalAdapter.linkAccount({
      userId: userId.toString(),
      providerId: "credential",
      accountId: userId.toString(),
      password: passwordHash,
    });
  }

  await PasswordReset.invalidateAllForUser(userId.toString());
}
