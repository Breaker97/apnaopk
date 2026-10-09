import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import {
  PRODUCT_REASONS,
  STOCK_ADJUSTMENT_REASONS,
  StockMovementList,
  StockMovementQuery,
  type StockMovement,
  type StockMovementActor,
} from "@/contracts/mobile/biz/v1/products";
import { resolveActorVendorId } from "@/lib/activity-log/actor-vendor";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { staffLocationIds } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { mongoose } from "@/lib/db";
import {
  readStockMovements,
  type StockMovementRecord,
} from "@/lib/inventory/stock-movements";
import { User } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import { variantCaption } from "./dto";
import { findScopedProduct } from "./load";

/**
 * GET /products/{id}/stock-movements: what moved a product's stock, newest
 * first, read from what the store records (lib/inventory/stock-movements.ts:
 * adjustments, transfers, returns put back on sale), in the reach of the
 * stock read: the product in the operator's scope (404 otherwise), and a
 * staff member assigned to locations seeing the movements at those only.
 *
 * Names are the store's as they are now (a variant's options, a location's
 * name, a person's), else as the record kept them. A seller and their staff
 * see who of their own team moved units; a movement by the marketplace's team
 * is "the store's", unnamed and without its note, as their Activity Log keeps
 * those rows from them.
 */

const refuse = (status: number, code: "VALIDATION_ERROR" | "AUTHORIZATION_ERROR", reason: string, message: string) =>
  new MobileApiError(status, code, message, { reason });

/** The position after a page's last movement: its time and key. */
function encodeCursor(movement: StockMovementRecord): string {
  return Buffer.from(JSON.stringify([movement.at.getTime(), movement.key])).toString("base64url");
}

/** A cursor this list gave out; anything else is a 400. */
function readCursor(cursor: string): { at: Date; key: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [time, key] = parsed as [unknown, unknown];
      if (Number.isSafeInteger(time) && typeof key === "string" && /^[art]:[0-9a-z:]{1,120}$/i.test(key)) {
        return { at: new Date(time as number), key };
      }
    }
  } catch {
    // Falls through to the refusal.
  }
  throw new MobileApiError(400, "VALIDATION_ERROR", "The cursor is not one this list gave out.", {
    errors: { cursor: ["Send back the nextCursor of the previous page."] },
  });
}

/** The store's word for a role, from the user's role as recorded. */
function roleWord(role: string | undefined): StockMovementActor["role"] {
  if (role === "admin") return "admin";
  if (role === "vendor") return "vendor";
  if (role === "staff" || role === "seller") return "staff";
  return undefined;
}

type Person = { name?: string; email?: string; role?: string; vendorId?: string };

/**
 * The people of a page, by user id. In a seller's workspace also whom each
 * acted for, for the records that do not say (transfers and returns).
 */
async function peopleOf(movements: StockMovementRecord[], sellerId: string | null): Promise<Map<string, Person>> {
  const ids = [
    ...new Set(
      movements
        .map((movement) => movement.actor.userId)
        .filter((id): id is string => Boolean(id && mongoose.isValidObjectId(id))),
    ),
  ];
  const people = new Map<string, Person>();
  if (ids.length === 0) return people;
  const users = await User.find({ _id: { $in: ids } })
    .select("name email role")
    .lean<Array<{ _id: unknown; name?: string; email?: string; role?: string }>>();
  for (const user of users) {
    people.set(String(user._id), { name: user.name || undefined, email: user.email, role: user.role });
  }
  if (sellerId) {
    const unstamped = new Set(
      movements.filter((movement) => !movement.actor.vendorRecorded).map((movement) => movement.actor.userId),
    );
    await Promise.all(
      [...unstamped].map(async (id) => {
        const person = id ? people.get(id) : undefined;
        if (!id || !person) return;
        person.vendorId = await resolveActorVendorId(id, person.role);
      }),
    );
  }
  return people;
}

async function locationNamesOf(movements: StockMovementRecord[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      movements
        .map((movement) => movement.locationId)
        .filter((id): id is string => Boolean(id && mongoose.isValidObjectId(id))),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await InventoryLocation.find({ _id: { $in: ids } })
    .select("name")
    .lean<Array<{ _id: unknown; name?: string }>>();
  return new Map(rows.filter((row) => row.name).map((row) => [String(row._id), row.name as string]));
}

function actorOf(
  movement: StockMovementRecord,
  people: Map<string, Person>,
  sellerId: string | null,
): StockMovementActor {
  const recorded = movement.actor;
  const person = recorded.userId ? people.get(recorded.userId) : undefined;
  if (!recorded.userId && !recorded.label) return { kind: "system" };
  if (sellerId) {
    const actingFor = recorded.vendorRecorded ? recorded.vendorId : person?.vendorId;
    if (actingFor !== sellerId) return { kind: "store" };
  }
  const name = person?.name || recorded.label || person?.email;
  const role = roleWord(recorded.role ?? person?.role);
  return { kind: "person", ...(name ? { name } : {}), ...(role ? { role } : {}) };
}

const ADJUSTMENT_REASONS: ReadonlySet<string> = new Set(STOCK_ADJUSTMENT_REASONS);

export const stockMovementsRoute = defineBizRoute({
  id: "products.stock-movements",
  method: "GET",
  path: "/products/{id}/stock-movements",
  auth: "user",
  ...BIZ_ACCESS.VIEW_STOCK,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:inventory:read", preset: "lenient" },
  input: StockMovementQuery,
  output: StockMovementList,
  reasons: { values: PRODUCT_REASONS },
  handler: async ({ input, params, scope, workspace }) => {
    const product = await findScopedProduct(params.id, scope);
    const variants = product.variants ?? [];
    if (input.variantId && !variants.some((variant) => String(variant._id) === input.variantId)) {
      throw refuse(400, "VALIDATION_ERROR", "UNKNOWN_VARIANT", "Not a variant of this product.");
    }
    const assigned = staffLocationIds(scope);
    if (input.locationId && assigned.length > 0 && !assigned.includes(input.locationId)) {
      throw refuse(403, "AUTHORIZATION_ERROR", "LOCATION_NOT_ALLOWED", "Not a location you can see stock at.");
    }

    const page = await readStockMovements({
      productId: String(product._id),
      variantId: input.variantId,
      locationId: input.locationId,
      onlyLocations: assigned,
      before: input.cursor ? readCursor(input.cursor) : undefined,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
    });

    const sellerId = workspace.workspace === "vendor" ? workspace.vendor.id : null;
    const [people, locationNames] = await Promise.all([
      peopleOf(page.movements, sellerId),
      locationNamesOf(page.movements),
    ]);
    const variantNames = new Map(variants.map((variant) => [String(variant._id), variantCaption(variant, product)]));

    const items = page.movements.map((movement): StockMovement => {
      const actor = actorOf(movement, people, sellerId);
      const variantName = (movement.variantId && variantNames.get(movement.variantId)) || movement.variantName;
      const locationName = (movement.locationId && locationNames.get(movement.locationId)) || movement.locationName;
      return {
        id: movement.key,
        at: movement.at.toISOString(),
        kind: movement.kind,
        change: movement.change,
        ...(movement.quantityAfter !== undefined ? { quantityAfter: movement.quantityAfter } : {}),
        ...(movement.variantId ? { variantId: movement.variantId } : {}),
        ...(variantName ? { variantName } : {}),
        ...(movement.locationId ? { locationId: movement.locationId } : {}),
        ...(locationName ? { locationName } : {}),
        ...(movement.reason && ADJUSTMENT_REASONS.has(movement.reason)
          ? { reason: movement.reason as StockMovement["reason"] }
          : {}),
        ...(movement.set ? { set: true } : {}),
        ...(movement.note && actor.kind !== "store" ? { note: movement.note } : {}),
        ...(movement.reference ? { reference: movement.reference } : {}),
        actor,
      };
    });
    const last = page.movements[page.movements.length - 1];
    return { items, nextCursor: page.more && last ? encodeCursor(last) : null };
  },
});
