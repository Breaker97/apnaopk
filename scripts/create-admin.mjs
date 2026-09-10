import mongoose from "mongoose";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { twoFactor } from "better-auth/plugins";
import { ObjectId } from "mongodb";
import { randomBytes } from "crypto";

function inferDbNameFromMongoUri(uri) {
  const withoutQuery = (uri.split("?")[0] ?? uri).trim();
  const slashIndex = withoutQuery.lastIndexOf("/");
  if (slashIndex === -1) return undefined;
  const candidate = withoutQuery.slice(slashIndex + 1);
  if (!candidate) return undefined;
  return candidate;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generatePassword() {
  return randomBytes(18).toString("base64url");
}

function parseObjectId(value) {
  if (typeof value !== "string") return null;
  if (!ObjectId.isValid(value)) return null;
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
}

async function upgradeUserToAdminByEmail(db, email) {
  const emailQuery = { email: new RegExp(`^${escapeRegExp(email)}$`, "i") };
  const updateResult = await db
    .collection("user")
    .findOneAndUpdate(
      emailQuery,
      // `status` is enforced for every role, so an account left inactive would
      // be promoted to admin and still refused at sign-in. Granting admin means
      // the account must work — this is the documented lockout recovery path.
      { $set: { role: "admin", roles: ["admin"], status: "active" } },
      { returnDocument: "after" },
    );

  if (!updateResult) return null;
  if (typeof updateResult === "object" && "value" in updateResult) {
    return updateResult.value || null;
  }
  return updateResult;
}

async function getUserByEmail(db, email) {
  const emailQuery = { email: new RegExp(`^${escapeRegExp(email)}$`, "i") };
  return db.collection("user").findOne(emailQuery);
}

// The admin Team page reads AdminProfile, and `isSuperAdmin` on it marks the
// store Owner (protected from demotion, suspension and removal). A recovery
// admin gets a profile, and inherits the Owner designation only when the store
// has none — never steals it from an existing owner.
async function ensureAdminProfile(db, userId) {
  const profiles = db.collection("adminprofiles");
  const existingOwner = await profiles.findOne(
    { isSuperAdmin: true },
    { projection: { _id: 1, userId: 1 } },
  );
  const existing = await profiles.findOne({ userId });
  const now = new Date();

  if (existing) {
    if (!existingOwner) {
      await profiles.updateOne(
        { _id: existing._id },
        { $set: { isSuperAdmin: true, updatedAt: now } },
      );
      console.log("Designated this account as the store owner.");
    }
    return;
  }

  await profiles.insertOne({
    userId,
    permissions: [],
    isSuperAdmin: !existingOwner,
    createdAt: now,
    updatedAt: now,
  });
  if (!existingOwner) {
    console.log("Designated this account as the store owner.");
  }
}

function createBetterAuthInstance(db, client) {
  const baseURL =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  return betterAuth({
    baseURL,
    database: mongodbAdapter(db, {
      client,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "customer",
          input: false,
        },
        roles: {
          type: "string[]",
          required: false,
          defaultValue: ["customer"],
          input: false,
        },
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          input: false,
        },
        phone: {
          type: "string",
          required: false,
          input: true,
        },
        twoFactorEnabled: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
        emailVerifiedAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },
    plugins: [twoFactor()],
    account: {
      storeStateStrategy: "cookie",
    },
    trustedOrigins: [baseURL],
  });
}

async function setCredentialPasswordForUser(
  auth,
  db,
  userObjectId,
  newPassword,
) {
  if (!userObjectId) throw new Error("Missing user id");
  if (!newPassword) throw new Error("Missing new password");

  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(newPassword);

  const existingAccount = await db
    .collection("account")
    .findOne(
      { userId: userObjectId, providerId: "credential" },
      { projection: { _id: 1 } },
    );

  if (existingAccount?._id) {
    await db.collection("account").updateOne(
      { _id: existingAccount._id },
      {
        $set: {
          password: passwordHash,
          updatedAt: new Date(),
        },
      },
    );
  } else {
    await ctx.internalAdapter.linkAccount({
      userId: userObjectId.toString(),
      providerId: "credential",
      accountId: userObjectId.toString(),
      password: passwordHash,
    });
  }

  await db.collection("session").deleteMany({ userId: userObjectId });
}

async function createAdmin() {
  const email = process.argv[2]?.trim().toLowerCase();
  const providedPassword = process.argv[3]?.trim();
  const providedName = process.argv[4]?.trim();

  if (!email) {
    console.error("Please provide an email address.");
    console.error("Usage: npm run create-admin <email> [password] [name]");
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  const dbName =
    process.env.MONGODB_DB_NAME || inferDbNameFromMongoUri(mongoUri);
  if (!dbName) {
    console.error(
      "Missing database name. Set MONGODB_DB_NAME, or include it in MONGODB_URI (e.g. mongodb://host:27017/your_db).",
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri, {
      dbName,
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    const db = mongoose.connection.db;
    if (!db) {
      console.error("MongoDB connection not available.");
      process.exit(1);
    }

    const client = mongoose.connection.getClient();
    const auth = createBetterAuthInstance(db, client);

    const desiredPassword =
      providedPassword || process.env.ADMIN_PASSWORD || null;

    const upgraded = await upgradeUserToAdminByEmail(db, email);
    if (upgraded) {
      console.log(
        `Successfully upgraded ${upgraded.name || "user"} (${email}) to Admin.`,
      );
      await ensureAdminProfile(db, upgraded._id);
      if (desiredPassword) {
        const existingUser = await getUserByEmail(db, email);
        if (!existingUser?._id) {
          throw new Error("User document not found after upgrade.");
        }
        await setCredentialPasswordForUser(
          auth,
          db,
          existingUser._id,
          desiredPassword,
        );
        console.log("Password updated.");
      }
      return;
    }

    const name =
      providedName || process.env.ADMIN_NAME || email.split("@")[0] || "Admin";
    const finalPassword = desiredPassword || generatePassword();

    let created;
    try {
      created = await auth.api.signUpEmail({
        body: {
          name,
          email,
          password: finalPassword,
        },
      });
    } catch (error) {
      console.error(
        `Better Auth user with email ${email} not found, and automatic creation failed.`,
      );
      console.error(
        "Create the user first via /register, then re-run this command, or provide required auth env vars (e.g. BETTER_AUTH_SECRET).",
      );
      throw error;
    }

    const createdUserId =
      created && typeof created === "object" && "user" in created
        ? created.user?.id
        : null;

    if (createdUserId) {
      const objectId = parseObjectId(createdUserId);
      if (objectId) {
        await db
          .collection("user")
          .updateOne(
            { _id: objectId },
            // `status` is enforced for every role, so an account left inactive would
      // be promoted to admin and still refused at sign-in. Granting admin means
      // the account must work — this is the documented lockout recovery path.
      { $set: { role: "admin", roles: ["admin"], status: "active" } },
          );
      } else {
        await upgradeUserToAdminByEmail(db, email);
      }
    } else {
      await upgradeUserToAdminByEmail(db, email);
    }

    const finalUser = await getUserByEmail(db, email);
    if (finalUser?._id) {
      await ensureAdminProfile(db, finalUser._id);
    }

    console.log(`Successfully created and upgraded ${email} to Admin.`);
    if (!desiredPassword) {
      console.log(`Generated password: ${finalPassword}`);
      console.log("Please change this password after your first login.");
    }
  } catch (error) {
    console.error("Error creating admin:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

createAdmin();
