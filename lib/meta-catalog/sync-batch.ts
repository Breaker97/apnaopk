import { createHash } from "node:crypto";
import type { ItemsBatchRequest } from "@/lib/meta-catalog/catalog-api";
import type { MetaCatalogItem } from "@/lib/meta-catalog/map-product";

/**
 * The pure part of the live sync: what Meta is sent for an item, how a change
 * is recognised, and how requests are packed into calls. No database, no
 * network — the worker (./sync-worker.ts) does those.
 */

/**
 * Optional fields the mapper may leave out. An UPDATE only changes the fields
 * it names, so one of these left out would keep its old value at Meta — a
 * sale that ended would still show its sale price. Meta clears a field given
 * an empty string (null leaves it alone), so each is always sent, empty when
 * the product has none.
 */
const CLEARABLE_FIELDS = [
  "sale_price",
  "brand",
  "gtin",
  "color",
  "size",
  "additional_variant_attribute",
  "custom_label_0",
] as const satisfies ReadonlyArray<keyof MetaCatalogItem>;

/** The `data` of an UPDATE request for one item. */
export function toItemsBatchData(item: MetaCatalogItem): Record<string, unknown> & { id: string } {
  const data: Record<string, unknown> & { id: string } = {
    id: item.id,
    // An item never moves in or out of a group: the product's own item and
    // its variants' items have different ids, so it never needs clearing.
    ...(item.item_group_id ? { item_group_id: item.item_group_id } : {}),
    title: item.title,
    description: item.description,
    availability: item.availability,
    condition: item.condition,
    price: item.price,
    link: item.link,
    image_link: item.image_link,
    additional_image_link:
      item.additional_image_link.length > 0 ? item.additional_image_link : "",
  };
  for (const field of CLEARABLE_FIELDS) data[field] = item[field] ?? "";
  return data;
}

/** A fingerprint of exactly what would be sent: equal hashes, nothing to send. */
export function metaItemHash(item: MetaCatalogItem): string {
  return createHash("sha256")
    .update(JSON.stringify(toItemsBatchData(item)))
    .digest("base64url")
    .slice(0, 22);
}

export type SentItem = { id: string; hash: string };

export type ProductSyncPlan = {
  /** UPDATEs for new and changed items, DELETEs for items that went away. */
  requests: ItemsBatchRequest[];
  /** What Meta holds for the product once the requests are through. */
  next: SentItem[];
};

/**
 * Compare what Meta was last sent for a product with the items it maps to
 * now. A new item and a changed one are both an UPDATE (Meta creates an item
 * it does not have); an item id that is no longer mapped — a variant removed,
 * a product hidden, deleted, or now selling as a pre-order — is a DELETE.
 */
export function planProductSync(
  sent: ReadonlyArray<SentItem>,
  items: ReadonlyArray<MetaCatalogItem>,
): ProductSyncPlan {
  const sentHash = new Map(sent.map((entry) => [entry.id, entry.hash]));
  const mapped = new Set<string>();
  const requests: ItemsBatchRequest[] = [];
  const next: SentItem[] = [];

  for (const item of items) {
    if (mapped.has(item.id)) continue;
    mapped.add(item.id);
    const hash = metaItemHash(item);
    next.push({ id: item.id, hash });
    if (sentHash.get(item.id) !== hash) {
      requests.push({ method: "UPDATE", data: toItemsBatchData(item) });
    }
  }
  for (const entry of sent) {
    if (!mapped.has(entry.id)) requests.push({ method: "DELETE", data: { id: entry.id } });
  }
  return { requests, next };
}

/** Meta takes up to 5,000 requests a call and recommends 3,000 at most. */
export const MAX_REQUESTS_PER_CALL = 3000;
/**
 * Meta allows 28 MB; a long description is ~10 KB, so 3,000 of them would
 * not fit. Kept well under, so a call also finishes inside the run's budget.
 */
export const MAX_BYTES_PER_CALL = 8 * 1024 * 1024;

export type CallPart<P> = { plan: P; requests: ItemsBatchRequest[] };

function requestBytes(request: ItemsBatchRequest): number {
  return Buffer.byteLength(JSON.stringify(request), "utf8") + 1;
}

/**
 * Pack products' requests into calls. A product's requests stay in one call,
 * so its record is either fully sent or not sent at all; only a product too
 * large for a call on its own is split, across consecutive calls.
 */
export function packCalls<P extends { requests: ItemsBatchRequest[] }>(
  plans: ReadonlyArray<P>,
  limits: { maxRequests?: number; maxBytes?: number } = {},
): Array<Array<CallPart<P>>> {
  const maxRequests = limits.maxRequests ?? MAX_REQUESTS_PER_CALL;
  const maxBytes = limits.maxBytes ?? MAX_BYTES_PER_CALL;
  const calls: Array<Array<CallPart<P>>> = [];
  let current: Array<CallPart<P>> = [];
  let count = 0;
  let bytes = 0;

  const flush = () => {
    if (current.length > 0) calls.push(current);
    current = [];
    count = 0;
    bytes = 0;
  };

  for (const plan of plans) {
    if (plan.requests.length === 0) continue;
    const sizes = plan.requests.map(requestBytes);
    const planBytes = sizes.reduce((sum, size) => sum + size, 0);

    if (plan.requests.length <= maxRequests && planBytes <= maxBytes) {
      if (count + plan.requests.length > maxRequests || bytes + planBytes > maxBytes) flush();
      current.push({ plan, requests: plan.requests });
      count += plan.requests.length;
      bytes += planBytes;
      continue;
    }

    // Too big for any one call: its own calls, one after another.
    flush();
    let part: ItemsBatchRequest[] = [];
    let partBytes = 0;
    plan.requests.forEach((request, index) => {
      if (
        part.length > 0 &&
        (part.length + 1 > maxRequests || partBytes + sizes[index] > maxBytes)
      ) {
        calls.push([{ plan, requests: part }]);
        part = [];
        partBytes = 0;
      }
      part.push(request);
      partBytes += sizes[index];
    });
    if (part.length > 0) calls.push([{ plan, requests: part }]);
  }
  flush();
  return calls;
}
