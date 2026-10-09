import type { Db } from "mongodb";
import { DEMO_ACCOUNTS } from "@/config/demo-credentials";

/**
 * Demo seeding and resets refuse a real store.
 *
 * `pnpm db:seed` and `db:seed:users` write the demo accounts — an admin login
 * printed in the README for everyone to read — and `db:reset` empties the
 * database without asking. Pointed at a store's own database by mistake (the
 * wrong .env, a buyer wanting the sample products), they handed anyone the
 * admin panel, or deleted the store. A database with an admin who is not one
 * of the demo accounts belongs to a real store, and these refuse it unless
 * told, in so many words, to go ahead.
 */

const ALLOW_REAL_STORE_FLAG = "--allow-real-store";
const ALLOW_REAL_STORE_ENV = "STORIFY_ALLOW_REAL_STORE";

const DEMO_EMAILS = Object.values(DEMO_ACCOUNTS).map((account) =>
  account.email.toLowerCase(),
);

/** The published demo passwords, which no real account may use. */
export const DEMO_PASSWORDS: readonly string[] = Object.values(DEMO_ACCOUNTS).map(
  (account) => account.password,
);

/** The email of an admin who is not a demo account, if the store has one. */
async function findRealStoreAdmin(db: Db): Promise<string | null> {
  const admin = await db.collection("user").findOne(
    {
      $or: [{ role: "admin" }, { roles: "admin" }],
      email: { $nin: DEMO_EMAILS },
    },
    { projection: { email: 1 } },
  );
  return admin ? String(admin.email) : null;
}

export async function assertNotRealStore(db: Db, action: string): Promise<void> {
  if (
    process.argv.includes(ALLOW_REAL_STORE_FLAG) ||
    process.env[ALLOW_REAL_STORE_ENV] === "1"
  ) {
    return;
  }
  const admin = await findRealStoreAdmin(db);
  if (admin) {
    throw new Error(
      `Refusing to ${action}: this database belongs to a real store — its admin ${admin} is not a demo account. ` +
        `Check MONGODB_URI. If this really is a throwaway database, run again with ${ALLOW_REAL_STORE_FLAG} ` +
        `(or ${ALLOW_REAL_STORE_ENV}=1 for db:full-reset).`,
    );
  }
}
