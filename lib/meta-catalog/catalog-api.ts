import "server-only";

import { graphRequest } from "@/lib/meta/graph-client";

/**
 * The three Catalog API calls the live sync makes, in Meta's shapes
 * (developers.facebook.com/docs/marketing-api/catalog-batch):
 *
 * - `GET /{catalog_id}?fields=id,name` — "Test connection".
 * - `POST /{catalog_id}/items_batch` with `item_type=PRODUCT_ITEM` — up to
 *   5,000 requests a call (Meta recommends 3,000 at most), 28 MB. An UPDATE
 *   with `allow_upsert` creates the item when Meta does not have it. Meta
 *   checks each request as it arrives (`validation_status`) and ingests the
 *   rest in the background under the `handles` it answers with.
 * - `GET /{catalog_id}/check_batch_request_status?handle=…` — how that
 *   background ingest went, with the ids it refused.
 */

/** Catalog ids are Graph object ids: digits only. */
export const META_CATALOG_ID_PATTERN = /^\d{5,30}$/;

export type ItemsBatchRequest =
  | { method: "UPDATE"; data: Record<string, unknown> & { id: string } }
  | { method: "DELETE"; data: { id: string } };

export interface ItemsBatchAnswer {
  handles: string[];
  /** Items Meta refused on arrival, by item id; the rest were taken. */
  rejected: Array<{ id: string; message: string }>;
}

export type BatchState = "pending" | "finished" | "failed";

export interface BatchStatusAnswer {
  state: BatchState;
  /** Meta's own word, lower-cased. */
  status: string;
  /** Item ids Meta did not save. */
  invalidIds: string[];
  /** A sample of Meta's reasons (not every error is listed). */
  errors: Array<{ id?: string; message: string }>;
}

function catalogPath(catalogId: string, edge?: string): string {
  return `${encodeURIComponent(catalogId)}${edge ? `/${edge}` : ""}`;
}

export async function readMetaCatalog(
  catalogId: string,
  token: string,
): Promise<{ id: string; name: string }> {
  const answer = await graphRequest<{ id?: string; name?: string }>({
    path: `${catalogPath(catalogId)}?fields=id,name`,
    token,
  });
  return { id: String(answer.id ?? catalogId), name: String(answer.name ?? "").trim() };
}

type RawMessage = { message?: string } | string | null | undefined;

function messagesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return (list as RawMessage[])
    .map((entry) => (typeof entry === "string" ? entry : entry?.message))
    .filter((message): message is string => typeof message === "string" && message.trim() !== "")
    .map((message) => message.trim().slice(0, 500));
}

export async function sendItemsBatch(
  catalogId: string,
  token: string,
  requests: ItemsBatchRequest[],
): Promise<ItemsBatchAnswer> {
  const answer = await graphRequest<{
    handles?: unknown;
    validation_status?: Array<{ retailer_id?: unknown; errors?: unknown }>;
  }>({
    path: catalogPath(catalogId, "items_batch"),
    token,
    method: "POST",
    form: {
      item_type: "PRODUCT_ITEM",
      allow_upsert: "true",
      requests: JSON.stringify(requests),
    },
    // A few thousand items are validated before Meta answers.
    timeoutMs: 25_000,
  });
  const handles = Array.isArray(answer.handles)
    ? answer.handles.filter((handle): handle is string => typeof handle === "string" && handle !== "")
    : [];
  const rejected: ItemsBatchAnswer["rejected"] = [];
  for (const entry of Array.isArray(answer.validation_status) ? answer.validation_status : []) {
    const reasons = messagesOf(entry?.errors);
    if (reasons.length === 0 || entry?.retailer_id === undefined) continue;
    rejected.push({ id: String(entry.retailer_id), message: reasons.join(" · ").slice(0, 1000) });
  }
  return { handles, rejected };
}

function stateOf(status: string): BatchState {
  if (status === "finished") return "finished";
  if (status === "canceled" || status === "cancelled" || status === "error") return "failed";
  return "pending";
}

export async function checkItemsBatch(
  catalogId: string,
  token: string,
  handle: string,
): Promise<BatchStatusAnswer> {
  const query = new URLSearchParams({
    handle,
    load_ids_of_invalid_requests: "true",
    fields: "handle,status,errors,errors_total_count,ids_of_invalid_requests",
  });
  type Row = {
    status?: unknown;
    errors?: Array<{ id?: unknown; message?: unknown }>;
    ids_of_invalid_requests?: unknown;
  };
  const answer = await graphRequest<{ data?: Row[] } & Row>({
    path: `${catalogPath(catalogId, "check_batch_request_status")}?${query.toString()}`,
    token,
  });
  // Meta's guide shows the row inside `data`; the reference shows it bare.
  const row: Row = Array.isArray(answer.data) ? (answer.data[0] ?? {}) : answer;
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  const invalidIds = Array.isArray(row.ids_of_invalid_requests)
    ? row.ids_of_invalid_requests.map(String)
    : [];
  const errors = (Array.isArray(row.errors) ? row.errors : [])
    .map((entry) => ({
      id: entry?.id === undefined || entry?.id === null ? undefined : String(entry.id),
      message: typeof entry?.message === "string" ? entry.message.trim().slice(0, 500) : "",
    }))
    .filter((entry) => entry.message !== "");
  return { state: stateOf(status), status, invalidIds, errors };
}
