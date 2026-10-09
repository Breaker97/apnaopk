import mongoose from "mongoose";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { twoFactor } from "better-auth/plugins";
import { ObjectId } from "mongodb";

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

async function getUserByEmail(db, email) {
  const emailQuery = { email: new RegExp(`^${escapeRegExp(email)}$`, "i") };
  return db.collection("user").findOne(emailQuery);
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

async function setCredentialPasswordForUser(auth, db, userObjectId, newPassword) {
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

async function main() {
  const email = process.argv[2]?.trim();
  const password = process.argv[3]?.trim();

  if (!email || !password) {
    console.error("Usage: npm run link-credential <email> <password>");
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

    const user = await getUserByEmail(db, email);
    if (!user?._id || !ObjectId.isValid(user._id)) {
      console.error("User not found.");
      process.exit(1);
    }

    await setCredentialPasswordForUser(auth, db, user._id, password);
    console.log(`Credential password set for ${email}.`);
  } catch (error) {
    console.error("Error linking credential:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();

