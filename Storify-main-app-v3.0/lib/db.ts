import mongoose from "mongoose";

/**
 * MongoDB Connection Singleton
 * Handles connection pooling and caching for serverless environments
 */

// Declare global mongoose cache type
declare global {
  var mongooseCache: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const shouldLog = process.env.NODE_ENV !== "production";

/**
 * Allow aggregation-pipeline updates — `updateOne(filter, [{ $set: … }])`.
 *
 * Mongoose 9 began rejecting them unless this is set, and eight call sites in
 * this codebase are written that way, every one of them because it needs to
 * compute a new value FROM the stored one inside a single atomic write:
 * the refund reservation that stops two concurrent refunds both passing the
 * cap (`PUT /api/admin/orders/[id]`), the same guard on both returns routes,
 * boost billing, preorder stock, and the charge-row re-sync. None of them can
 * be expressed as a plain `$set` without reading first and racing.
 *
 * Set globally rather than passed at each call: a pipeline update that forgets
 * the flag does not fail a type-check, it throws at runtime on a money path —
 * which is exactly how this was found, as a 500 from an admin order edit. One
 * place to state the intent is the only version of this that stays true.
 */
mongoose.set("updatePipeline", true);

/**
 * Connections this process may hold open.
 *
 * One pool is shared by everything the process serves — page renders, API
 * routes, webhooks, cron — so it is the ceiling on concurrency, not a
 * per-feature setting. When it is exhausted, requests queue inside the driver
 * and the wait shows up as latency on *every* surface at once, which reads
 * like "the whole site got slow" rather than "the database is busy".
 *
 * 50 suits a single app instance against a normal Mongo tier. Raise it for
 * heavier traffic (a mobile client on the same API, several app instances),
 * but keep `instances × MONGODB_MAX_POOL_SIZE` under the connection limit of
 * your Mongo plan — Atlas M0 allows 500, M10 allows 1500.
 */
const DEFAULT_MAX_POOL_SIZE = 50;

/**
 * Default for a serverless deployment, where the ceiling is not this process.
 *
 * The 50 above assumes one long-running server: one pool, sized against the
 * database's limit. A serverless platform instead runs many short-lived
 * instances side by side, each building a pool of its own, so the real figure
 * is `instances × pool`. Twenty concurrent instances at 50 would ask for a
 * thousand connections and exhaust an Atlas M0 (500) — as connection errors on
 * checkout, at exactly the traffic peak that spawned the instances.
 *
 * Small pools are the right shape there anyway: an instance serves few
 * concurrent requests, so most of a large pool would sit idle while still
 * counting against the cluster.
 *
 * Override with `MONGODB_MAX_POOL_SIZE` once you know your own instance count
 * and plan limit.
 */
const SERVERLESS_MAX_POOL_SIZE = 5;

/**
 * Whether this process is one of many short-lived instances.
 *
 * `VERCEL` is set by that platform; `AWS_LAMBDA_FUNCTION_NAME` covers Lambda
 * directly and the several platforms that run functions on it. A container on
 * a VPS sets neither and keeps the single-process default.
 */
function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
  );
}

function resolveMaxPoolSize(): number {
  const raw = Number.parseInt(process.env.MONGODB_MAX_POOL_SIZE || "", 10);
  if (Number.isFinite(raw) && raw >= 1) return raw;
  return isServerlessRuntime()
    ? SERVERLESS_MAX_POOL_SIZE
    : DEFAULT_MAX_POOL_SIZE;
}

// Initialize the cached connection
let cached = global.mongooseCache;

if (!cached) {
  cached = global.mongooseCache = { conn: null, promise: null };
}

/**
 * Connect to MongoDB
 * Uses connection pooling and caching for optimal performance
 */
export async function connectDB(): Promise<typeof mongoose> {
  // Return cached connection if available
  if (cached.conn) {
    return cached.conn;
  }

  // Create new connection if no promise exists
  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
      maxPoolSize: resolveMaxPoolSize(),
      serverSelectionTimeoutMS: 5000,
      /**
       * How long a single TCP connect + handshake may stall before the driver
       * abandons it.
       *
       * The driver's own default is 30s, which quietly outlives the 5s budget
       * on the line above. Server selection does give up after 5s, but the
       * reason it reports is whatever the in-flight connection attempt last
       * said, and that attempt keeps its pool slot pinned for the full 30s —
       * so a brief network stall to the database surfaces as
       * `MongoServerSelectionError: Socket 'connect' timed out after 30001ms`
       * on a render that was only ever willing to wait five seconds, and the
       * pool is still working through stale attempts once the network is back.
       *
       * 8s leaves generous room for a cross-region round trip plus TLS and
       * SCRAM auth while failing in the same order of magnitude as the
       * selection timeout, so a stalled socket is dropped and retried instead
       * of held.
       */
      connectTimeoutMS: 8000,
      socketTimeoutMS: 45000,
      // Large stores should set MONGODB_AUTO_INDEX=false and manage index
      // changes via the migration scripts (scripts/migrate-*.mjs): implicit
      // createIndex on cold starts can trigger surprise index builds on big
      // collections. Left ON by default so fresh installs still get their
      // indexes (including the unique ones) without an extra setup step.
      autoIndex: process.env.MONGODB_AUTO_INDEX !== "false",
    };

    if (!MONGODB_URI) {
      throw new Error(
        "Please define the MONGODB_URI environment variable inside .env"
      );
    }

    // Per-query logging for request-cost audits (run with `next start`):
    // `MONGOOSE_DEBUG=true` prints every collection.op(filter), so the round
    // trips a page costs can be counted instead of guessed; `=stack` prints
    // the app frames that issued each query instead of the filter, which is
    // how an uncached read hiding behind three helpers gets found.
    if (process.env.MONGOOSE_DEBUG === "true") {
      mongoose.set("debug", true);
    } else if (process.env.MONGOOSE_DEBUG === "stack") {
      mongoose.set("debug", (collectionName: string, method: string) => {
        const frames = (new Error().stack ?? "")
          .split("\n")
          .slice(1)
          .filter((line) => !/node_modules|mongoose|node:internal/.test(line))
          .slice(0, 6)
          .join("\n");
        console.log(`Mongoose: ${collectionName}.${method}\n${frames}`);
      });
    }

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      if (shouldLog) {
        console.log("MongoDB connected");
      }
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    console.error("MongoDB connection error:", error);
    throw error;
  }

  return cached.conn;
}

/**
 * Disconnect from MongoDB
 * Useful for graceful shutdown
 */
export async function disconnectDB(): Promise<void> {
  if (cached.conn) {
    await mongoose.disconnect();
    cached.conn = null;
    cached.promise = null;
    if (shouldLog) {
      console.log("MongoDB disconnected");
    }
  }
}

// Export mongoose for schema creation
export { mongoose };
