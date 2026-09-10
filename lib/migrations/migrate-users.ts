/**
 * User Migration Script
 *
 * This script updates existing users to ensure data consistency:
 * 1. Sync 'role' field to 'roles' array if roles is empty
 * 2. Initialize account 'status' with default "active"
 * 3. Initialize 2FA fields with defaults
 *
 * Run with: npx ts-node scripts/migrate-users.ts
 * Or via API: GET /api/admin/migrate-users (admin only)
 */

import { connectDB, mongoose } from "@/lib/db";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";

// Also sync users in Better Auth "user" collection
export async function migrateBetterAuthUsers(): Promise<{
  total: number;
  synced: number;
  errors: string[];
}> {
  await connectDB();

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database not connected");
  }

  // Better Auth uses lowercase "user" collection
  const userCollection = db.collection("user");
  const errors: string[] = [];
  let synced = 0;

  const users = await userCollection.find({}).toArray();
  const total = users.length;

  for (const user of users) {
    try {
      const updates: Record<string, unknown> = {};
      const role = user.role as string | undefined;
      const roles = user.roles as string[] | undefined;

      // Ensure role exists (default to customer)
      if (!role) {
        updates.role = "customer";
      }

      // Sync role to roles array
      if (role && (!roles || roles.length === 0)) {
        updates.roles = [role];
      } else if (!roles || roles.length === 0) {
        updates.roles = ["customer"];
      }

      // Initialize 2FA fields if missing
      if (user.twoFactorEnabled === undefined) {
        updates.twoFactorEnabled = false;
      }

      // Initialize account status if missing
      if (!user.status) {
        updates.status = USER_ACCOUNT_STATUS.ACTIVE;
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await userCollection.updateOne({ _id: user._id }, { $set: updates });
        synced++;
      }
    } catch (error) {
      errors.push(`Error updating user ${user.email}: ${error}`);
    }
  }

  return { total, synced, errors };
}
