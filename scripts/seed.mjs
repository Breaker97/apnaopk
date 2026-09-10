import mongoose from "mongoose";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { randomBytes, randomUUID } from "crypto";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import {
  ADMIN_PERMISSIONS,
  STAFF_PERMISSIONS,
} from "@/config/permissions.config.js";
import { ORDER_STATUS } from "@/config/app.config.js";
import { DEMO_ACCOUNTS } from "@/config/demo-credentials";
import { buildBarcodeRegistryEntries } from "@/lib/products/barcode-registry";
import { LOCAL_ASSET_PATHS } from "@/lib/seed-assets";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import { buildStorePageIdentity } from "@/models/store-page.model";
import {
  DEFAULT_SEED_TEMPLATE,
  parseTemplateArg,
  readSnapshotFile,
  resolveSeedTemplate,
} from "./seed-templates.mjs";

/**
 * Demo credentials for the default seeded accounts. Shared with
 * `pnpm db:seed:users` and the DEMO_MODE quick-login card so the three can
 * never advertise a login this seeder does not create — see
 * `config/demo-credentials.ts`.
 */
const DEMO_CREDENTIALS = DEMO_ACCOUNTS;

/**
 * The demo store's name. It is written to `general.storeName` and nowhere else:
 * every other place the name appears — the browser tab, link previews, email
 * senders, category page titles — must derive it at render time, or renaming
 * the store in Settings → General leaves stale copies of this brand behind.
 */
const DEMO_STORE_NAME = "Storify";

const ROLES = {
  ADMIN: "admin",
  VENDOR: "vendor",
  CUSTOMER: "customer",
  SELLER: "seller",
};

/**
 * Catalog snapshots exported from a template's live demo store by
 * `scripts/export-seed-data.mjs` (pnpm db:seed:export). The seed imports these
 * byte-faithful — original ids included — so every cross-reference in the data
 * (product → vendor/category/collection, variant → location, storefront
 * section bindings, menu links) keeps working without any remapping.
 *
 * Which store: `--template=<id>` picks one of `scripts/seed-data/<id>/`, since
 * every theme in the gallery ships its OWN catalog — the home page a theme
 * publishes is designed around the products beneath it.
 */
const SEED_TEMPLATE = resolveSeedTemplate(
  parseTemplateArg() || DEFAULT_SEED_TEMPLATE,
);

/** Non-default snapshot vendors log in as `<slug>@example.com` with this. */
const SNAPSHOT_VENDOR_PASSWORD = "vendor123";

function loadSnapshot(name, options) {
  return readSnapshotFile(SEED_TEMPLATE.dir, name, options);
}

/**
 * Import one snapshot collection through the raw driver (no schema casting) so
 * the documents land exactly as they exist on the live store. Skips when the
 * collection already has data, mirroring the other creators' re-run behavior.
 */
async function importSnapshot(Model, snapshotName, { transform } = {}) {
  const existingCount = await Model.countDocuments();
  if (existingCount > 0) {
    console.log(
      `   ✓ ${Model.modelName} data already exists (${existingCount}), skipping...`,
    );
    return false;
  }

  const docs = loadSnapshot(snapshotName);
  if (docs.length === 0) {
    console.log(`   • Snapshot ${snapshotName} is empty, nothing to import`);
    return true;
  }

  const prepared = transform ? docs.map(transform) : docs;
  await Model.collection.insertMany(prepared, { ordered: true });
  console.log(`   ✓ Imported ${prepared.length} ${snapshotName} from snapshot`);
  return true;
}

/**
 * Refuse to seed a database whose catalog predates the snapshots.
 *
 * A database seeded before the snapshot era holds vendors/categories/products
 * under ids the snapshots don't know. The per-collection "already exists,
 * skipping" guards would then quietly assemble a hybrid store — snapshot
 * products under old categories, or a vendor insert dying on the unique
 * userId index because the demo email's user already owns an old-format
 * vendor. Catch that state up front, with instructions, instead.
 */
async function assertSnapshotCompatible() {
  const checks = [
    [mongoose.models.Vendor, "vendors"],
    [mongoose.models.Category, "categories"],
    [mongoose.models.Product, "products"],
  ];
  for (const [Model, snapshotName] of checks) {
    const existing = await Model.countDocuments();
    if (existing === 0) continue;
    const ids = loadSnapshot(snapshotName).map((doc) => doc._id);
    const matching = await Model.countDocuments({ _id: { $in: ids } });
    if (matching === 0) {
      throw new Error(
        `The ${snapshotName} collection already holds ${existing} document(s) ` +
          `that do not come from scripts/seed-data/${SEED_TEMPLATE.id} — this ` +
          "database was seeded from a different template, " +
          "before the snapshot era, or carries different data. Mixing the two " +
          "would produce a broken store, so nothing was written. Run " +
          "`pnpm db:full-reset` to wipe and rebuild it from the snapshot, or " +
          "point MONGODB_URI / MONGODB_DB_NAME at an empty database.",
      );
    }
  }
}

/**
 * Generate a SKU from product title.
 * Mirrors lib/utils.ts generateSku() so seeded products line up with runtime-created ones.
 */
function generateSku(title) {
  const cleaned = title.trim().replace(/[^a-zA-Z0-9\s]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  let base;
  if (words.length >= 2) {
    base = words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  } else if (words.length === 1) {
    base = words[0].substring(0, 3).toUpperCase();
  } else {
    base = "PRD";
  }
  const suffix = Math.random().toString(16).substring(2, 6).toUpperCase();
  return `${base}-${suffix}`;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
      transaction: true,
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

/**
 * Execute a function within a MongoDB transaction if available
 * Falls back to regular execution if replica set is not available
 * Prevents race conditions during user/vendor creation in production
 *
 * Transient errors are retried per MongoDB's transaction contract: on a
 * virgin database the very first writes create their collections mid-
 * transaction, and the server may answer with a retryable WriteConflict
 * ("catalog changes") instead of committing.
 */
async function withTransaction(callback) {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const result = await callback(session);
        await session.commitTransaction();
        return result;
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    } catch (error) {
      // If transactions not supported (standalone MongoDB), fall back to regular execution
      if (error.code === 20 || error.codeName === "IllegalOperation") {
        console.warn(
          "⚠️  Transactions not supported (requires replica set), using standard operations",
        );
        return await callback(null);
      }
      const transient =
        typeof error?.hasErrorLabel === "function" &&
        error.hasErrorLabel("TransientTransactionError");
      if (transient && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Guarantee a Better Auth credential account for a user, outside any
 * transaction. Better Auth's adapter writes with its own connection — a
 * `session` passed in its payload is stored as data, not honored as a
 * transaction — so an account created inside `withTransaction` survives the
 * rollback when the transaction retries, leaving an orphaned row. Creating it
 * after commit, guarded by a lookup, keeps retries and re-runs clean and
 * heals a seeded user that lost its account.
 */
async function ensureCredentialAccount(auth, userId, password) {
  const ctx = await auth.$context;
  const accounts = await ctx.internalAdapter.findAccounts(String(userId));
  if (accounts.some((account) => account.providerId === "credential")) return;

  await ctx.internalAdapter.createAccount({
    userId: String(userId),
    providerId: "credential",
    accountId: String(userId),
    password: await ctx.password.hash(password),
  });
}

/**
 * Create the demo admin user, link credentials, and ensure a SuperAdmin profile exists.
 * Uses transactions to prevent race conditions
 */
async function createAdmin(User, AdminProfile, auth) {
  const { name, email, password } = DEMO_CREDENTIALS.admin;

  const admin = await withTransaction(async (session) => {
    const existingAdmin = await User.findOne({ email }).session(session);
    if (existingAdmin) {
      const existingProfile = await AdminProfile.findOne({
        userId: existingAdmin._id,
      }).session(session);
      if (!existingProfile) {
        await AdminProfile.create(
          [
            {
              userId: existingAdmin._id,
              isSuperAdmin: true,
              permissions: Object.values(ADMIN_PERMISSIONS),
              department: "Operations",
            },
          ],
          { session },
        );
      }
      console.log(`   ✓ Admin already exists: ${email}`);
      return existingAdmin;
    }

    const ctx = await auth.$context;
    const passwordHash = await ctx.password.hash(password);

    const admin = await User.create(
      [
        {
          name,
          email,
          password: passwordHash,
          role: ROLES.ADMIN,
          roles: [ROLES.ADMIN],
          emailVerified: true,
          emailVerifiedAt: new Date(),
          status: "active",
          phone: DEMO_CREDENTIALS.admin.phone,
        },
      ],
      { session },
    );

    await AdminProfile.create(
      [
        {
          userId: admin[0]._id,
          isSuperAdmin: true,
          permissions: Object.values(ADMIN_PERMISSIONS),
          department: "Operations",
        },
      ],
      { session },
    );

    console.log(`   ✓ Created admin: ${email} / ${password}`);
    return admin[0];
  });

  await ensureCredentialAccount(auth, admin._id, password);
  return admin;
}

/**
 * Import the snapshot vendors and create a login account for each one.
 *
 * Vendor documents keep their original ids so products, inventory locations
 * and storefront bindings that reference them keep working; only the linked
 * auth user is created fresh (the export strips real accounts). The default
 * vendor — the single-vendor-mode store owner — gets the demo vendor
 * credentials; every other vendor logs in as `<slug>@example.com`.
 * Uses transactions to prevent race conditions.
 */
async function createVendors(User, Vendor, auth) {
  const snapshot = loadSnapshot("vendors");

  // Exactly ONE store may be the house store. The demo vendor login is handed
  // to whichever vendor carries `isDefault`, and `Vendor.userId` is unique —
  // so two flagged vendors would both resolve to the same user and the second
  // insert would die on a duplicate key, halfway through the seed. Live stores
  // really do end up with the flag on more than one document (a deleted-and-
  // recreated house store leaves it behind), which is why the export audit
  // clears the extras and why this refuses rather than picking one at random.
  const defaults = snapshot.filter((data) => data.isDefault === true);
  if (defaults.length !== 1) {
    throw new Error(
      `The ${SEED_TEMPLATE.id} vendor snapshot has ${defaults.length} vendors flagged isDefault ` +
        `(${defaults.map((d) => d.slug).join(", ") || "none"}); exactly one is required. ` +
        `Re-export it with \`pnpm db:seed:export --template=${SEED_TEMPLATE.id}\`, which repairs this.`,
    );
  }

  const vendors = [];
  for (const data of snapshot) {
    const isDefault = data.isDefault === true;
    const email = isDefault
      ? DEMO_CREDENTIALS.vendor.email
      : `${data.slug}@example.com`;
    const password = isDefault
      ? DEMO_CREDENTIALS.vendor.password
      : SNAPSHOT_VENDOR_PASSWORD;

    const vendor = await withTransaction(async (session) => {
      const existingVendor = await Vendor.findById(data._id).session(session);
      if (existingVendor) {
        console.log(`   ✓ Vendor already exists: ${data.storeName}`);
        return existingVendor;
      }

      const ctx = await auth.$context;
      const passwordHash = await ctx.password.hash(password);

      let user = await User.findOne({ email }).session(session);
      if (!user) {
        const created = await User.create(
          [
            {
              name: data.storeName,
              email,
              password: passwordHash,
              role: ROLES.VENDOR,
              roles: [ROLES.VENDOR],
              emailVerified: true,
              emailVerifiedAt: new Date(),
              status: "active",
            },
          ],
          { session },
        );
        user = created[0];
      }

      // Raw insert keeps the snapshot document intact; only ownership is
      // rewired to the freshly created login user.
      await Vendor.collection.insertOne(
        { ...data, userId: user._id },
        session ? { session } : {},
      );

      console.log(
        `   ✓ Created vendor: ${data.storeName} (${email} / ${password})`,
      );
      return await Vendor.findById(data._id).session(session);
    });

    await ensureCredentialAccount(auth, vendor.userId, password);
    vendors.push(vendor);
  }

  return vendors;
}

/**
 * Create demo customers and seed CustomerProfile with cached stats and tier data.
 * Uses transactions to prevent race conditions
 */
async function createCustomers(User, CustomerProfile, auth) {
  const customersData = [
    {
      name: DEMO_CREDENTIALS.customer.name,
      email: DEMO_CREDENTIALS.customer.email,
      password: DEMO_CREDENTIALS.customer.password,
      tier: "gold",
    },
    {
      name: "Jane Shopper",
      email: "customer2@example.com",
      password: "customer123",
      tier: "silver",
    },
    {
      name: "Bob Buyer",
      email: "customer3@example.com",
      password: "customer123",
      tier: "bronze",
    },
  ];

  const customers = [];
  for (const data of customersData) {
    const customer = await withTransaction(async (session) => {
      const existingCustomer = await User.findOne({
        email: data.email,
      }).session(session);
      if (existingCustomer) {
        const existingProfile = await CustomerProfile.findOne({
          userId: existingCustomer._id,
        }).session(session);
        if (!existingProfile) {
          await CustomerProfile.create(
            [
              {
                userId: existingCustomer._id,
                loyaltyPoints: 0,
                lifetimePoints: 0,
                loyaltyTier: "bronze",
                marketingOptIn: true,
              },
            ],
            { session },
          );
        }
        console.log(`   ✓ Customer already exists: ${data.email}`);
        return existingCustomer;
      }

      const ctx = await auth.$context;
      const passwordHash = await ctx.password.hash(data.password);

      const user = await User.create(
        [
          {
            name: data.name,
            email: data.email,
            password: passwordHash,
            role: ROLES.CUSTOMER,
            roles: [ROLES.CUSTOMER],
            emailVerified: true,
            emailVerifiedAt: new Date(),
            status: "active",
            phone: `+1 555-${randomBetween(1000, 9999)}`,
            addresses: [
              {
                firstName: data.name.split(" ")[0],
                lastName: data.name.split(" ").slice(1).join(" "),
                street: `${randomBetween(100, 999)} Customer Ave`,
                city: "New York",
                state: "NY",
                postalCode: "10001",
                country: "USA",
                phone: `+1 555-${randomBetween(1000, 9999)}`,
                isDefault: true,
                label: "home",
              },
            ],
          },
        ],
        { session },
      );

      await CustomerProfile.create(
        [
          {
            userId: user[0]._id,
            loyaltyPoints: 0,
            lifetimePoints: 0,
            loyaltyTier: "bronze",
            marketingOptIn: true,
            emailNotifications: {
              orderUpdates: true,
              promotions: true,
              newsletter: false,
              priceDrops: false,
              backInStock: false,
            },
            stats: {
              totalOrders: 0,
              totalSpent: 0,
              averageOrderValue: 0,
              totalReviews: 0,
              totalWishlistItems: 0,
            },
            tags: ["demo"],
            acquisitionSource: "seed",
            lastActiveAt: new Date(),
          },
        ],
        { session },
      );

      console.log(`   ✓ Created customer: ${data.email} / ${data.password}`);
      return user[0];
    });

    await ensureCredentialAccount(auth, customer._id, data.password);
    customers.push(customer);
  }

  return customers;
}

/**
 * Create a staff (seller) user and associated StaffProfile assigned by the admin.
 * Uses transactions to prevent race conditions
 */
async function createStaff(User, StaffProfile, auth, adminUserId) {
  const { name, email, password } = DEMO_CREDENTIALS.staff;

  const staffUser = await withTransaction(async (session) => {
    const existingStaff = await User.findOne({ email }).session(session);
    if (existingStaff) {
      const existingProfile = await StaffProfile.findOne({
        userId: existingStaff._id,
      }).session(session);
      if (!existingProfile) {
        await StaffProfile.create(
          [
            {
              userId: existingStaff._id,
              assignedBy: adminUserId,
              permissions: Object.values(STAFF_PERMISSIONS),
              department: "Sales Floor",
              isActive: true,
            },
          ],
          { session },
        );
      }
      console.log(`   ✓ Staff already exists: ${email}`);
      return existingStaff;
    }

    const ctx = await auth.$context;
    const passwordHash = await ctx.password.hash(password);

    const staffUser = await User.create(
      [
        {
          name,
          email,
          password: passwordHash,
          role: ROLES.SELLER,
          roles: [ROLES.SELLER],
          emailVerified: true,
          emailVerifiedAt: new Date(),
          status: "active",
        },
      ],
      { session },
    );

    await StaffProfile.create(
      [
        {
          userId: staffUser[0]._id,
          assignedBy: adminUserId,
          permissions: Object.values(STAFF_PERMISSIONS),
          department: "Sales Floor",
          notes: "Default seeded staff with full POS + sales permissions.",
          isActive: true,
        },
      ],
      { session },
    );

    console.log(`   ✓ Created staff: ${email} / ${password}`);
    return staffUser[0];
  });

  await ensureCredentialAccount(auth, staffUser._id, password);
  return staffUser;
}

/**
 * Inventory locations — imported BEFORE products because the snapshot
 * products' variant locationInventory references these exact location ids.
 */
async function createInventoryLocations(InventoryLocation) {
  await importSnapshot(InventoryLocation, "inventory-locations");
  return await InventoryLocation.find();
}

/**
 * The snapshot category tree — parent/child links, images, live product
 * counts and SEO come along verbatim.
 */
async function createCategories(Category) {
  await importSnapshot(Category, "categories");
  return await Category.find();
}

async function createBrands(Brand) {
  await importSnapshot(Brand, "brands");
}

/** Store-level variant option library (Color, Storage, …) used by the product
 * form; products embed resolved copies so this is presentation data only. */
async function createGlobalVariants(GlobalVariant) {
  await importSnapshot(GlobalVariant, "global-variants");
}

/**
 * Import the snapshot products and register their barcodes.
 *
 * Documents land verbatim: variants (with barcodes and per-location stock),
 * options, media, SEO, ratings and price ranges are the live store's own.
 * The barcode registry backs SKU/barcode uniqueness at runtime, so imported
 * variant barcodes must be registered or later products could collide.
 */
async function createProducts(Product, BarcodeRegistry) {
  const imported = await importSnapshot(Product, "products");
  const products = await Product.find().lean();

  if (imported && BarcodeRegistry) {
    // Through the app's own builder, not a local copy of the rule: a product
    // can carry a barcode of its OWN as well as one per variant, and a
    // hand-rolled variant-only loop left those 28 unregistered — invisible
    // until a POS scan misses them or a later edit hands the same code to a
    // second product because nothing had reserved it.
    const rows = products.flatMap((product) =>
      buildBarcodeRegistryEntries(product).map((entry) => ({
        ...entry,
        productId: product._id,
        active: true,
      })),
    );
    if (rows.length > 0) {
      try {
        await BarcodeRegistry.insertMany(rows, { ordered: false });
        console.log(`   ✓ Registered ${rows.length} variant barcodes`);
      } catch (error) {
        // Duplicate registrations are fine on partial re-runs.
        if (error?.code !== 11000) throw error;
        console.log("   ✓ Barcode registry already populated");
      }
    }
  }

  return products;
}

/**
 * Create a mix of online + POS orders spread across the last 30 days.
 * Online orders carry subOrders for multi-vendor split; POS orders include staff + location.
 */
async function createOrders(
  Order,
  customers,
  products,
  vendors,
  staffUser,
  locations,
) {
  const orderStatuses = [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.SHIPPED,
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.CANCELLED,
  ];
  const paymentStatuses = ["pending", "paid", "paid", "paid", "refunded"];

  const existingCount = await Order.countDocuments();
  if (existingCount > 0) {
    console.log(`   ✓ Orders already exist (${existingCount}), skipping...`);
    return await Order.find().lean();
  }

  const defaultLocation = locations.find((l) => l.isDefault) || locations[0];
  const orders = [];

  // Determine sequential order numbering starting from ORD000001
  for (let i = 0; i < 20; i++) {
    const customer = pickOne(customers);
    const isPos = i % 5 === 0;
    const numItems = 1 + Math.floor(Math.random() * 3);

    // Group items by vendor so we can build subOrders for multi-vendor splits
    const itemsByVendor = new Map();
    const flatItems = [];

    for (let j = 0; j < numItems; j++) {
      const product = pickOne(products);
      const quantity = 1 + Math.floor(Math.random() * 3);
      const item = {
        productId: product._id,
        vendorId: product.vendorId,
        name: product.name,
        sku: product.sku || generateSku(product.name),
        price: product.price,
        quantity,
        image: product.images?.[0] || "",
      };
      flatItems.push(item);

      const vid = String(product.vendorId);
      if (!itemsByVendor.has(vid)) itemsByVendor.set(vid, []);
      itemsByVendor.get(vid).push(item);
    }

    const subtotal = flatItems.reduce(
      (sum, it) => sum + it.price * it.quantity,
      0,
    );
    const shippingCost = isPos ? 0 : 5;
    const tax = Math.round(subtotal * 0.08 * 100) / 100;
    const total = Math.round((subtotal + shippingCost + tax) * 100) / 100;

    const status = isPos ? ORDER_STATUS.DELIVERED : pickOne(orderStatuses);
    const paymentStatus = isPos
      ? "paid"
      : status === "cancelled"
        ? "pending"
        : pickOne(paymentStatuses);

    // Build subOrders — one per vendor — with commission/earnings
    const subOrders = [];
    for (const [vendorId, items] of itemsByVendor.entries()) {
      const vendor = vendors.find((v) => String(v._id) === vendorId);
      const commissionRate = vendor?.commission || 10;
      const sub = items.reduce((s, it) => s + it.price * it.quantity, 0);
      const commission = Math.round(((sub * commissionRate) / 100) * 100) / 100;
      const vendorEarnings = Math.round((sub - commission) * 100) / 100;

      subOrders.push({
        vendorId,
        items,
        subtotal: sub,
        commission,
        vendorEarnings,
        status,
        inventoryReserved: status !== "cancelled",
        payoutStatus:
          status === "delivered" && paymentStatus === "paid"
            ? "unpaid"
            : "unpaid",
      });
    }

    const orderNumber = isPos
      ? `POS${String(i + 1).padStart(6, "0")}`
      : `ORD${String(i + 1).padStart(6, "0")}`;

    const createdAt = new Date(
      Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
    );
    const processingAt =
      status !== "pending" ? new Date(createdAt.getTime() + 60_000) : undefined;
    const shippedAt = ["shipped", "delivered"].includes(status)
      ? new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000)
      : undefined;
    const deliveredAt =
      status === "delivered"
        ? new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)
        : undefined;
    const cancelledAt =
      status === "cancelled"
        ? new Date(createdAt.getTime() + 3600_000)
        : undefined;

    const order = await Order.create({
      orderNumber,
      customerId: customer._id,
      items: flatItems,
      subOrders,
      shippingAddress: {
        fullName: customer.name,
        firstName: customer.name.split(" ")[0],
        lastName: customer.name.split(" ").slice(1).join(" ") || "Customer",
        street: "123 Main Street",
        city: "New York",
        state: "NY",
        postalCode: "10001",
        country: "USA",
        phone: "+1 555-0123",
      },
      billingAddress: {
        fullName: customer.name,
        street: "123 Main Street",
        city: "New York",
        state: "NY",
        postalCode: "10001",
        country: "USA",
      },
      paymentMethod: isPos ? "cash" : pickOne(["stripe", "cod", "paypal"]),
      paymentStatus,
      subtotal,
      shippingCost,
      tax,
      discount: 0,
      total,
      channel: isPos ? "pos" : "online",
      posLocationId: isPos ? String(defaultLocation._id) : undefined,
      staffId: isPos ? String(staffUser._id) : undefined,
      status,
      processingAt,
      shippedAt,
      deliveredAt,
      cancelledAt,
      trackingNumber: shippedAt
        ? `TRK-${randomBytes(6).toString("hex").toUpperCase()}`
        : undefined,
      carrier: shippedAt ? pickOne(["UPS", "FedEx", "USPS", "DHL"]) : undefined,
      createdAt,
    });

    orders.push(order);
    console.log(`   ✓ Created order: ${orderNumber} (${status})`);
  }

  return orders;
}

async function createCoupons(Coupon, categories, adminId) {
  // The snapshot's own discounts come first: a `coupon-banner` on the seeded
  // home page names a code, and a store that advertises a code checkout has
  // never heard of is worse than one with no banner. Their validity window is
  // re-based on today — the exported one closed months ago, and an expired
  // discount hides the banner it was exported to fill.
  const snapshotCoupons = loadSnapshot("coupons", { optional: true }) ?? [];
  for (const data of snapshotCoupons) {
    if (await Coupon.findOne({ code: data.code })) {
      console.log(`   ✓ Coupon already exists: ${data.code}`);
      continue;
    }
    await Coupon.collection.insertOne({
      ...data,
      usedCount: 0,
      startDate: new Date(),
      endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      createdBy: String(adminId),
    });
    console.log(`   ✓ Imported coupon from snapshot: ${data.code}`);
  }

  const couponsData = [
    {
      code: "WELCOME10",
      label: "Welcome Discount",
      description: "10% off your first order over $25",
      type: "percentage",
      value: 10,
      minOrderAmount: 25,
      perUserLimit: 1,
    },
    {
      code: "SAVE20",
      label: "Save $20",
      description: "$20 off orders over $100",
      type: "fixed",
      value: 20,
      minOrderAmount: 100,
      perUserLimit: 3,
    },
    {
      code: "FREESHIP",
      label: "Free Shipping",
      description: "Free shipping on orders over $50",
      type: "free_shipping",
      value: 0,
      minOrderAmount: 50,
    },
    {
      code: "TECH15",
      label: "Tech Sale",
      description: "15% off phones and accessories",
      type: "percentage",
      value: 15,
      minOrderAmount: 0,
      maxDiscount: 200,
      applicableCategories: [
        categories.find((c) => c.slug === "phone")?._id,
        categories.find((c) => c.slug === "accessories")?._id,
      ].filter(Boolean),
    },
  ];

  for (const data of couponsData) {
    const existing = await Coupon.findOne({ code: data.code });
    if (existing) {
      console.log(`   ✓ Coupon already exists: ${data.code}`);
      continue;
    }
    await Coupon.create({
      ...data,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      usedCount: 0,
      createdBy: String(adminId),
    });
    console.log(`   ✓ Created coupon: ${data.code}`);
  }
}

/** Snapshot collections keep their ids — products' collectionIds and the
 * storefront's collection-bound sections point straight at them. */
async function createCollections(Collection) {
  await importSnapshot(Collection, "collections");
}

async function createSliders(Slider) {
  await importSnapshot(Slider, "sliders");
}

async function createReviews(Review, Product, orders) {
  // Only generate reviews for delivered orders so isVerified makes sense
  const deliveredOrders = orders.filter((o) => o.status === "delivered");
  const reviewsToCreate = [];

  for (const order of deliveredOrders.slice(0, 8)) {
    const item = order.items[0];
    if (!item) continue;
    if (
      reviewsToCreate.find(
        (r) =>
          String(r.productId) === String(item.productId) &&
          String(r.userId) === String(order.customerId) &&
          String(r.orderId) === String(order._id),
      )
    )
      continue;

    reviewsToCreate.push({
      productId: item.productId,
      userId: order.customerId,
      orderId: order._id,
      rating: randomBetween(3, 5),
      title: pickOne([
        "Great product!",
        "Highly recommended",
        "Worth the price",
        "Excellent quality",
      ]),
      comment: pickOne([
        "Exactly as described. Fast shipping and well-packaged.",
        "Quality exceeded my expectations. Will buy again.",
        "Solid product. Does what it promises.",
        "Loved it — bought another one for a friend.",
      ]),
      isVerified: true,
      isApproved: true,
    });
  }

  let count = 0;
  for (const review of reviewsToCreate) {
    try {
      await Review.create(review);
      count++;
    } catch {
      // Skip duplicates (unique index on productId+userId+orderId)
    }
  }

  // Recompute product rating + reviewCount from approved reviews
  const productIds = [
    ...new Set(reviewsToCreate.map((r) => String(r.productId))),
  ];
  for (const pid of productIds) {
    const productReviews = await Review.find({
      productId: pid,
      isApproved: true,
    });
    if (productReviews.length > 0) {
      const avg =
        productReviews.reduce((sum, r) => sum + r.rating, 0) /
        productReviews.length;
      await Product.updateOne(
        { _id: pid },
        {
          rating: Math.round(avg * 10) / 10,
          reviewCount: productReviews.length,
        },
      );
    }
  }

  console.log(`   ✓ Created ${count} reviews`);
}

async function createWishlists(Wishlist, customers, products) {
  let count = 0;
  for (const customer of customers) {
    const existing = await Wishlist.findOne({ userId: String(customer._id) });
    if (existing) continue;

    const picks = [];
    const usedIdx = new Set();
    const wishlistSize = randomBetween(2, 5);
    while (picks.length < wishlistSize && picks.length < products.length) {
      const idx = Math.floor(Math.random() * products.length);
      if (usedIdx.has(idx)) continue;
      usedIdx.add(idx);
      picks.push({
        productId: products[idx]._id,
        addedAt: new Date(
          Date.now() - Math.random() * 14 * 24 * 60 * 60 * 1000,
        ),
      });
    }

    await Wishlist.create({
      userId: String(customer._id),
      items: picks,
    });
    count++;
  }

  console.log(`   ✓ Created ${count} wishlists`);
}

/**
 * Import the snapshot blog, re-authored to the seeded admin — the original
 * author accounts are deliberately not exported.
 */
async function createBlog(BlogCategory, BlogPost, adminUserId, adminName) {
  await importSnapshot(BlogCategory, "blog-categories");
  await importSnapshot(BlogPost, "blog-posts", {
    transform: (post) => ({
      ...post,
      authorId: adminUserId,
      authorName: adminName,
    }),
  });
}

async function createMenus(Menu) {
  await importSnapshot(Menu, "menus");
}

/** Snapshot subscription plans for the become-vendor flow. Stripe price/product
 * references are stripped at export — each install syncs its own. */
async function createVendorPlans(VendorPlan, admin) {
  await importSnapshot(VendorPlan, "vendor-plans", {
    transform: (plan) => ({ ...plan, createdBy: String(admin._id) }),
  });
}

/** The admin-configured become-vendor wizard template. */
async function createOnboardingTemplate(OnboardingTemplate, admin) {
  await importSnapshot(OnboardingTemplate, "onboarding-template", {
    transform: (template) => ({ ...template, updatedBy: String(admin._id) }),
  });
}


async function createNotifications(Notification, admin, customers, orders) {
  const existingCount = await Notification.countDocuments();
  if (existingCount > 0) {
    console.log("   ✓ Notifications already exist, skipping...");
    return;
  }

  const recentOrders = orders.slice(-5);
  let count = 0;

  for (const order of recentOrders) {
    await Notification.create({
      userId: String(admin._id),
      type: "order_placed",
      title: "New order placed",
      message: `Order ${order.orderNumber} for $${order.total.toFixed(2)} was placed.`,
      link: `/admin/orders/${order._id}`,
      data: { orderId: String(order._id), orderNumber: order.orderNumber },
      isRead: Math.random() > 0.5,
    });
    count++;
  }

  // Customer-facing notifications
  for (const customer of customers.slice(0, 2)) {
    await Notification.create({
      userId: String(customer._id),
      type: "system",
      title: `Welcome to ${DEMO_STORE_NAME}!`,
      message:
        "Start exploring our products and enjoy 10% off with code WELCOME10.",
      link: "/products",
      isRead: false,
    });
    count++;
  }

  console.log(`   ✓ Created ${count} notifications`);
}

/**
 * The sponsored position ladder, plus enough bookings that the rail actually
 * renders on a fresh demo install.
 *
 * A ladder with no bookings is indistinguishable from a broken feature: every
 * placement returns null by design when nothing is sold within its own depth,
 * so `pnpm db:full-reset` would produce a store where boosting appears to do
 * nothing. Positions 1 and 3 are booked from today; 2 is left free ON PURPOSE,
 * because the unsold-rung-shows-a-regular-product behaviour is the single most
 * surprising thing about this model and the demo should show it.
 */
async function createBoostLadder(models, vendors, products, admin, Settings) {
  const { BoostPosition, BoostSlotDay, BoostCampaign, PlatformPayment } = models;
  if (!BoostPosition || !BoostSlotDay || !BoostCampaign) {
    console.log("   • boost models unavailable, skipping");
    return;
  }

  // `position` is unique — like every other creator, a re-run without a
  // db:reset must skip rather than die on the duplicate key.
  const existingPositions = await BoostPosition.countDocuments();
  if (existingPositions > 0) {
    console.log(
      `   ✓ Boost ladder already exists (${existingPositions} positions), skipping...`,
    );
    return;
  }

  // Turn on exactly what the ladder needs to be visible, and nothing else.
  // Boosting is gated behind multi-vendor mode — every booking belongs to a
  // vendor — and the seed has already created several vendors and their
  // products, so this demo is a marketplace either way. Written with $set
  // rather than inside createSettings because that function returns early when
  // a settings document already exists, which is the common case on a re-seed.
  if (Settings) {
    await Settings.updateOne(
      {},
      {
        $set: {
          "multiVendorMode.enabled": true,
          "boosting.enabled": true,
          // The home rail is a home-page-builder section; without a stored
          // limit the rail has no depth and renders nothing.
          "homePage.sections.sponsoredProducts.visible": true,
          "homePage.sections.sponsoredProducts.title": "Recommended for you",
          "homePage.sections.sponsoredProducts.limit": 8,
        },
      },
      { upsert: false },
    );

    // A stored sectionOrder written before this section existed simply omits
    // it, and an omitted id renders nowhere — so the rail would be configured,
    // sold and invisible. Slot it beside the other product rows rather than
    // appending, which would put the only paid section below the Instagram
    // strip.
    const current = await Settings.findOne({})
      .select("homePage.sectionOrder")
      .lean();
    const order = current?.homePage?.sectionOrder ?? [];
    if (order.length > 0 && !order.includes("sponsoredProducts")) {
      const at = order.indexOf("featuredProducts");
      const next = [...order];
      next.splice(at >= 0 ? at + 1 : next.length, 0, "sponsoredProducts");
      await Settings.updateOne({}, { $set: { "homePage.sectionOrder": next } });
      console.log("   ✓ sponsored rail added to the home page order");
    }

    console.log("   ✓ multi-vendor mode + boosting enabled");
  }

  const RUNGS = [
    {
      position: 1,
      label: "Top spot",
      description: "The first sponsored slot on every surface.",
      pricePerDay: 4,
    },
    {
      position: 2,
      label: "Runner-up",
      description: "Second slot on the home rail and product pages.",
      pricePerDay: 3,
    },
    {
      position: 3,
      label: "Third slot",
      description: "Home rail and product pages.",
      pricePerDay: 2,
    },
    {
      position: 5,
      label: "Deep shelf",
      description: "Home rail and product pages only — below the listing depth.",
      pricePerDay: 1,
    },
  ];

  const currency = "USD";
  const positions = await BoostPosition.insertMany(
    RUNGS.map((rung) => ({
      ...rung,
      currency,
      status: "active",
      createdBy: String(admin._id),
    })),
  );
  console.log(`   ✓ ${positions.length} ladder positions`);

  // UTC days, matching lib/boost-days.ts — the demo must not depend on the
  // seeding machine's timezone.
  const today = new Date().toISOString().slice(0, 10);
  const addDays = (day, n) =>
    new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86400000)
      .toISOString()
      .slice(0, 10);

  // One product per vendor, so the demo rail shows different stores rather than
  // the same seller twice.
  const byVendor = new Map();
  for (const product of products) {
    if (product.status !== "active") continue;
    const key = String(product.vendorId);
    if (!byVendor.has(key)) byVendor.set(key, product);
  }
  const picks = [...byVendor.values()].slice(0, 2);
  if (picks.length === 0) {
    console.log("   • no active products to book, ladder left empty");
    return;
  }

  // Position 2 is deliberately absent: an unsold rung must show a regular
  // product in the demo, or nobody discovers that until a vendor asks.
  const BOOKINGS = [
    { position: 1, days: 14 },
    { position: 3, days: 7 },
  ];

  let booked = 0;
  for (const [index, booking] of BOOKINGS.entries()) {
    const product = picks[index % picks.length];
    const rung = positions.find((p) => p.position === booking.position);
    if (!product || !rung) continue;

    const startDay = today;
    const endDay = addDays(today, booking.days - 1);
    const amount = rung.pricePerDay * booking.days;

    const campaign = await BoostCampaign.create({
      vendorId: product.vendorId,
      userId: String(admin._id),
      productId: product._id,
      positionId: rung._id,
      positionSnapshot: {
        position: rung.position,
        label: rung.label,
        pricePerDay: rung.pricePerDay,
        currency,
      },
      startDay,
      endDay,
      billedDays: booking.days,
      startsAt: new Date(`${startDay}T00:00:00.000Z`),
      endsAt: new Date(Date.parse(`${endDay}T00:00:00.000Z`) + 86400000),
      status: "active",
      activatedAt: new Date(),
      provider: "manual",
      amount,
      currency,
      paidAt: new Date(),
      createdBy: String(admin._id),
    });

    if (PlatformPayment) {
      const payment = await PlatformPayment.create({
        kind: "boost",
        campaignId: campaign._id,
        vendorId: product.vendorId,
        userId: String(admin._id),
        provider: "manual",
        status: "paid",
        amount,
        currency,
        paidAt: new Date(),
        reference: `seed-boost-${rung.position}-${startDay}`,
        boostTerms: { position: rung.position, startDay, endDay },
      });
      await BoostCampaign.updateOne(
        { _id: campaign._id },
        { $set: { paymentId: payment._id, paidAttemptId: payment._id } },
      );
    }

    // The inventory rows. Without these the calendar shows the days as free and
    // the demo can be double-booked against itself.
    const rows = [];
    for (let i = 0; i < booking.days; i += 1) {
      rows.push({
        position: rung.position,
        day: addDays(startDay, i),
        campaignId: campaign._id,
        vendorId: product.vendorId,
        productId: product._id,
        positionId: rung._id,
        reservationToken: null,
      });
    }
    await BoostSlotDay.insertMany(rows);
    booked += 1;
  }

  console.log(
    `   ✓ ${booked} live bookings (Position 2 left unsold, to show the gap)`,
  );
}

/**
 * Publish the storefront exactly as the live demo runs it: every template
 * (home, product, listing, category, collection, cart) and chrome group
 * (header, footer) from the snapshot, sections bound to the same catalog ids
 * that were just imported.
 *
 * Sections pass through `sanitizeSectionInstances` — the app's own contract —
 * so a snapshot from a diverged schema loses the invalid sections loudly here
 * instead of breaking the storefront at render time. Version history is
 * per-install working data and starts empty; authorship is stamped with the
 * seeded admin because real accounts are never exported.
 */
async function createStorefrontTemplate(StorePage, admin) {
  const pages = loadSnapshot("store-pages");
  const now = new Date();
  const by = String(admin._id);

  for (const page of pages) {
    const draftRaw = Array.isArray(page.draft?.sections)
      ? page.draft.sections
      : [];
    const publishedRaw = Array.isArray(page.published?.sections)
      ? page.published.sections
      : [];
    const draft = sanitizeSectionInstances(draftRaw);
    const published = sanitizeSectionInstances(publishedRaw);
    if (draft.length < draftRaw.length || published.length < publishedRaw.length) {
      console.warn(
        `   ⚠️  ${page.key}: dropped ${draftRaw.length - draft.length} draft / ${publishedRaw.length - published.length} published section(s) that no longer match the section schema — re-export the snapshot`,
      );
    }

    await StorePage.updateOne(
      { key: page.key },
      {
        $set: {
          ...buildStorePageIdentity(page.key),
          title: page.title,
          draft: {
            sections: draft,
            updatedAt: page.draft?.updatedAt ?? now,
            updatedBy: by,
          },
          ...(page.published
            ? {
                published: {
                  sections: published,
                  publishedAt: page.published.publishedAt ?? now,
                  publishedBy: by,
                },
              }
            : {}),
          history: [],
        },
      },
      { upsert: true },
    );
  }

  console.log(`  ✓ Storefront published from snapshot (${pages.length} surfaces)`);
}

async function createSettings(Settings) {
  const existing = await Settings.findOne();
  if (existing) {
    console.log("   ✓ Settings already exist, skipping...");
    return;
  }

  // The live store's presentation/config sections (branding, storefront
  // chrome, content pages, shipping zones, POS, …) overlay the defaults
  // below section-by-section. Credential-bearing sections — payment, email,
  // storage, security, analytics — are never exported, so for those the safe
  // defaults stand and each install configures its own.
  const snapshot = loadSnapshot("settings");

  await Settings.create({
    general: {
      storeName: DEMO_STORE_NAME,
      storeDescription: "Multi-vendor E-commerce Platform",
      storeEmail: "support@storify.com",
      storePhone: "+1 555-0100",
      storeAddress: "123 Main Street, New York, NY 10001",
      logoUrl: LOCAL_ASSET_PATHS.logos.main,
      darkModeLogoUrl: LOCAL_ASSET_PATHS.logos.dark,
      // Favicon and OG image are admin-uploaded branding — the app ships no
      // bundled icon, so a fresh store starts without them.
      faviconUrl: "",
      defaultLanguage: "en",
      defaultCurrency: "USD",
      supportedLanguages: [
        "en",
        "bn",
        "ar",
        "hi",
        "zh",
        "ja",
        "ko",
        "fr",
        "es",
      ],
      supportedCurrencies: ["USD", "EUR", "GBP", "BDT", "INR", "UGX"],
      timezone: "America/New_York",
    },
    appearance: {
      primaryColor: "#2065D1",
      secondaryColor: "#8b5cf6",
      accentColor: "#f59e0b",
      theme: "system",
      contrast: false,
      rtl: false,
      compact: false,
      navLayout: "mini",
      navColor: "integrate",
      presetColor: "default",
    },
    payment: {
      stripe: {
        enabled: false,
        publishableKey: "",
        secretKey: "",
        webhookSecret: "",
      },
      paypal: {
        enabled: false,
        clientId: "",
        clientSecret: "",
        mode: "sandbox",
      },
      razorpay: { enabled: false, keyId: "", keySecret: "" },
      paystack: { enabled: false, publicKey: "", secretKey: "" },
      pesapal: {
        enabled: false,
        consumerKey: "",
        consumerSecret: "",
        mode: "sandbox",
        ipnId: "",
      },
      iotec: {
        enabled: false,
        clientId: "",
        clientSecret: "",
        walletId: "",
        mode: "sandbox",
      },
      cod: {
        enabled: true,
        instructions: "Pay with cash when your order is delivered.",
        minOrderAmount: 0,
      },
    },
    email: {
      provider: "smtp",
      enabled: false,
      smtp: { port: 587, secure: false },
      fromEmail: "no-reply@storify.com",
      // Left empty on purpose: `lib/email/email.ts` falls back to the live store
      // name, so a renamed store signs its mail with its own name.
      fromName: "",
    },
    orders: {
      prefix: "ORD",
      // A FRACTION, not a percentage — the schema caps it at 1. `8` meant "8%"
      // and failed validation, so `createSettings` could never actually run and
      // a fresh `pnpm db:full-reset` died before writing any settings at all.
      taxRate: 0.08,
      freeShippingThreshold: 0,
      defaultShippingCost: 5,
      commission: { vendorRate: 10, minWithdrawalAmount: 50 },
    },
    shipping: {
      enabled: true,
      origin: {
        country: "USA",
        state: "NY",
        city: "New York",
        postalCode: "10001",
        address1: "123 Main Street",
      },
      delivery: {
        processingDaysMin: 1,
        processingDaysMax: 2,
        showEstimatedDelivery: true,
      },
      zones: [
        {
          id: randomUUID(),
          name: "United States",
          countries: ["USA"],
          regions: [],
          rates: [
            {
              id: randomUUID(),
              name: "Standard",
              type: "flat",
              price: 5.99,
              minDays: 3,
              maxDays: 5,
              active: true,
            },
            {
              id: randomUUID(),
              name: "Free Shipping (over $50)",
              type: "free_over",
              price: 0,
              freeOver: 50,
              minDays: 5,
              maxDays: 7,
              active: true,
            },
          ],
        },
      ],
      fallbackRate: {
        enabled: true,
        name: "Standard",
        price: 9.99,
        minDays: 5,
        maxDays: 10,
      },
      localPickup: {
        enabled: false,
      },
    },
    seo: {
      // Left empty on purpose: a meta title outranks `general.storeName` in the
      // browser tab, `og:title` and every search result, so seeding one freezes
      // the demo brand into a store that has since been renamed.
      metaTitle: "",
      metaDescription:
        "Shop premium products from top vendors. Fast shipping and easy returns.",
      metaKeywords: "ecommerce, multi-vendor, online shopping",
      ogImage: "",
    },
    social: {},
    analytics: {},
    maintenance: {
      enabled: false,
      allowedIPs: [],
    },
    security: {
      emailVerificationRequired: false,
      emailVerificationForVendors: false,
      twoFactorEnabled: true,
      twoFactorRequiredForAdmin: false,
      twoFactorRequiredForVendors: false,
      twoFactorRequiredForStaff: false,
      googleOAuthEnabled: false,
      facebookOAuthEnabled: false,
      // Session lifetime, lockout budget and password floor are deliberately
      // omitted: the schema defaults are the single source of truth (see
      // lib/security-limits.ts), and a copy here silently overrode them —
      // seeding 5 login attempts after the default was raised to 10.
      requireUppercase: false,
      requireNumbers: false,
      requireSpecialChars: false,
      rateLimiting: {
        enabled: true,
        ipPreset: "default",
        adminPreset: "default",
        vendorPreset: "default",
        checkoutPreset: "default",
        cartPreset: "default",
        couponPreset: "default",
        authPreset: "default",
      },
    },
    pos: {
      enabled: true,
      allowAdminSales: true,
      allowVendorSales: true,
      allowSellerSales: true,
      language: "en",
      customize: {
        printedReceiptsEnabled: false,
        soundEnabled: true,
        soundVolume: 50,
        soundAddToCart: true,
        soundOrderComplete: true,
        soundPayment: true,
        soundError: true,
      },
      checkout: {
        paymentMethods: ["cash", "card"],
        offlinePaymentsEnabled: false,
      },
      orders: {
        orderNumberPrefix: "POS",
      },
    },
    multiVendorMode: {
      enabled: true,
      canManageProducts: true,
      canViewOrders: true,
      canManageOrders: true,
      canManageStoreSettings: true,
      canViewAnalytics: true,
      canManagePayouts: true,
      canAccessPOS: true,
    },
    storage: {
      provider: "cloudflare_r2",
      region: "auto",
      maxFileSizeMB: 20,
      maxImageSizeMB: 20,
      maxVideoSizeMB: 1024,
      maxModelSizeMB: 500,
      pathPrefix: "uploads/",
    },
    aiSalesAgent: {
      enabled: false,
      model: "gpt-5-mini",
      temperature: 0.3,
      reasoningEffort: "minimal",
      maxRecommendations: 4,
      agentName: "Sales AI",
      greeting:
        "Hi! I can help you find products, compare options, add items to your cart, and check order status.",
      tone: "friendly",
      escalationMessage:
        "I can connect you with the store team for anything that needs a human review.",
      widget: {
        position: "bottom-right",
        primaryColor: "#7c3aed",
        accentColor: "#a855f7",
        footerText: "Powered by AI",
      },
      capabilities: {
        productQA: true,
        recommendations: true,
        cartActions: true,
        checkoutHandoff: true,
        orderStatus: true,
      },
    },
    homePage: {
      sectionOrder: [
        "hero",
        "featuredCategories",
        "newArrivals",
        "promotionsOffers",
        "featuredProducts",
        "topVendors",
        "becomeVendor",
        "topArticles",
        "fromInstagram",
      ],
      sections: {
        hero: {
          visible: true,
          slides: [{ imageSrc: "", alt: "", href: "" }],
        },
        featuredCategories: {
          visible: true,
          title: "Featured Categories",
          limit: 8,
        },
        newArrivals: {
          visible: true,
          title: "Products on Sale",
          subtitle: "",
          desktopColumns: 4,
        },
        promotionsOffers: {
          visible: true,
          cards: [
            { imageSrc: "", href: "/products" },
            { imageSrc: "", href: "/products" },
            { imageSrc: "", href: "/products" },
            { imageSrc: "", href: "/products" },
            { imageSrc: "", href: "/products" },
          ],
        },
        topVendors: {
          visible: true,
          title: "Top Vendors",
          limit: 8,
        },
        featuredProducts: {
          visible: true,
          title: "",
        },
        topArticles: {
          visible: true,
          title: "Top Articles",
          limit: 9,
          desktopColumns: 4,
        },
        becomeVendor: {
          visible: true,
          imageSrc: "",
          title: "Start Selling With Us Today",
          subtitle:
            "Join our marketplace, manage products easily, accept secure payments, and grow your business faster.",
          buttonLabel: "Become a Vendor",
          buttonHref: "/become-vendor",
        },
        fromInstagram: {
          visible: true,
          title: "From Instagram",
          items: [
            { imageSrc: "", href: "" },
            { imageSrc: "", href: "" },
            { imageSrc: "", href: "" },
            { imageSrc: "", href: "" },
            { imageSrc: "", href: "" },
          ],
        },
      },
    },
    contentPages: {
      terms: {
        title: "Terms of Service",
        content:
          "<h2>Terms of Service</h2><p>Add your store's terms of service here.</p>",
        visible: true,
      },
      privacy: {
        title: "Privacy Policy",
        content:
          "<h2>Privacy Policy</h2><p>Add your privacy policy details here.</p>",
        visible: true,
      },
      cookies: {
        title: "Cookie Policy",
        content:
          "<h2>Cookie Policy</h2><p>Describe the cookies your site uses and why.</p>",
        visible: true,
      },
      accessibility: {
        title: "Accessibility",
        content:
          "<h2>Accessibility</h2><p>Share your accessibility standards and support contact details.</p>",
        visible: true,
      },
      faq: {
        title: "Frequently Asked Questions",
        subtitle:
          "Find quick answers to common questions about shopping, shipping, and returns.",
        visible: true,
        items: [
          {
            id: "faq-shipping",
            question: "How long does shipping take?",
            answer:
              "Standard shipping usually takes 3-7 business days depending on your location.",
          },
          {
            id: "faq-returns",
            question: "What is your return policy?",
            answer:
              "You can return eligible items within 30 days of delivery. Items must be unused and in original packaging.",
          },
          {
            id: "faq-tracking",
            question: "How can I track my order?",
            answer:
              "Once your order ships, you will receive a tracking link by email and in your account order history.",
          },
        ],
      },
      customPages: [],
    },
    ...snapshot,
  });

  console.log("   ✓ Created settings (safe defaults + live snapshot sections)");
}

async function seedCounters(Counter, orders) {
  // Pre-seed order number counters so subsequent runtime orders pick up where seed left off.
  const onlineOrders = orders.filter((o) => o.channel !== "pos");
  const posOrders = orders.filter((o) => o.channel === "pos");

  if (onlineOrders.length > 0) {
    const maxSeq = onlineOrders
      .map((o) => parseInt(String(o.orderNumber).replace(/^ORD/, ""), 10) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    await Counter.updateOne(
      { _id: "online_order:ORD" },
      { $set: { seq: maxSeq } },
      { upsert: true },
    );
  }

  if (posOrders.length > 0) {
    const maxSeq = posOrders
      .map((o) => parseInt(String(o.orderNumber).replace(/^POS/, ""), 10) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    await Counter.updateOne(
      { _id: "pos_order:POS" },
      { $set: { seq: maxSeq } },
      { upsert: true },
    );
  }

  console.log("   ✓ Seeded order number counters");
}

async function seed() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✓ Connected to MongoDB");
    console.log(`✓ Seeding the "${SEED_TEMPLATE.id}" template snapshot`);

    await import("@/models");

    const db = mongoose.connection.db;
    const client = mongoose.connection.getClient();
    const auth = createBetterAuthInstance(db, client);

    const {
      User,
      Vendor,
      Category,
      Brand,
      GlobalVariant,
      Product,
      BarcodeRegistry,
      Order,
      Coupon,
      Collection,
      Slider,
      Settings,
      CustomerProfile,
      AdminProfile,
      StaffProfile,
      InventoryLocation,
      BlogCategory,
      BlogPost,
      Menu,
      VendorPlan,
      OnboardingTemplate,
      Review,
      Wishlist,
      Notification,
      Counter,
      BoostPosition,
      BoostSlotDay,
      BoostCampaign,
      PlatformPayment,
      StorePage,
    } = mongoose.models;

    await assertSnapshotCompatible();

    console.log("\n👤 Creating admin...");
    const admin = await createAdmin(User, AdminProfile, auth);

    console.log("\n🏪 Creating vendors...");
    const vendors = await createVendors(User, Vendor, auth);

    console.log("\n👥 Creating customers...");
    const customers = await createCustomers(User, CustomerProfile, auth);

    console.log("\n🧑‍💼 Creating staff...");
    const staff = await createStaff(User, StaffProfile, auth, admin._id);

    console.log("\n📍 Importing inventory locations...");
    const locations = await createInventoryLocations(InventoryLocation);

    console.log("\n📁 Importing categories...");
    const categories = await createCategories(Category);

    console.log("\n🏷️  Importing brands...");
    await createBrands(Brand);

    console.log("\n🎨 Importing global variants...");
    await createGlobalVariants(GlobalVariant);

    console.log("\n📦 Importing products...");
    const products = await createProducts(Product, BarcodeRegistry);

    console.log("\n📚 Importing collections...");
    await createCollections(Collection);

    console.log("\n🖼️  Importing sliders...");
    await createSliders(Slider);

    console.log("\n📝 Creating orders...");
    const orders = await createOrders(
      Order,
      customers,
      products,
      vendors,
      staff,
      locations,
    );

    console.log("\n🔢 Seeding counters...");
    await seedCounters(Counter, orders);

    console.log("\n⭐ Creating reviews...");
    await createReviews(Review, Product, orders);

    console.log("\n❤️  Creating wishlists...");
    await createWishlists(Wishlist, customers, products);

    console.log("\n🎟️  Creating coupons...");
    await createCoupons(Coupon, categories, admin._id);

    console.log("\n🔔 Creating notifications...");
    await createNotifications(Notification, admin, customers, orders);

    console.log("\n📰 Importing blog content...");
    await createBlog(BlogCategory, BlogPost, admin._id, admin.name);

    console.log("\n🧭 Importing menus...");
    await createMenus(Menu);

    console.log("\n📋 Importing vendor plans...");
    await createVendorPlans(VendorPlan, admin);

    console.log("\n🪜 Importing the vendor onboarding template...");
    await createOnboardingTemplate(OnboardingTemplate, admin);

    console.log("\n⚙️  Creating settings...");
    await createSettings(Settings);

    console.log("\n🎨 Publishing the storefront from the snapshot...");
    await createStorefrontTemplate(StorePage, admin);

    console.log("\n🚀 Creating boost ladder...");
    await createBoostLadder(
      { BoostPosition, BoostSlotDay, BoostCampaign, PlatformPayment },
      vendors,
      products,
      admin,
      Settings,
    );

    console.log("\n✅ Database seeded successfully!\n");
    console.log("=".repeat(60));
    console.log("Demo Credentials:");
    console.log("=".repeat(60));
    console.log(
      `Admin:    ${DEMO_CREDENTIALS.admin.email} / ${DEMO_CREDENTIALS.admin.password}`,
    );
    console.log(
      `Vendor:   ${DEMO_CREDENTIALS.vendor.email} / ${DEMO_CREDENTIALS.vendor.password}`,
    );
    console.log(
      `Customer: ${DEMO_CREDENTIALS.customer.email} / ${DEMO_CREDENTIALS.customer.password}`,
    );
    console.log(
      `Staff:    ${DEMO_CREDENTIALS.staff.email} / ${DEMO_CREDENTIALS.staff.password}`,
    );
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Seed failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
