/**
 * Settings → Meta catalog's wire shapes (lib/meta-catalog/page-state.ts and
 * lib/meta-catalog/live-dto.ts, as JSON) and its one request helper.
 */

export type MetaPauseCode = "token" | "permission" | "catalog" | "key";

export type MetaLiveDto = {
  catalogId: string | null;
  tokenSet: boolean;
  tokenHint: string | null;
  catalogName: string | null;
  verifiedAt: string | null;
  paused: { at: string; reason: string; code: MetaPauseCode } | null;
  throttledUntil: string | null;
  lastSyncAt: string | null;
  lastRunError: string | null;
  waiting: number;
  rejected: number;
  failing: number;
  checking: boolean;
  lastCheckedAt: string | null;
  skipped: { preorder: number; noImage: number; noPrice: number } | null;
  canStoreToken: boolean;
  graphVersionSet: boolean;
};

export type MetaPageDto = {
  enabled: boolean;
  source: "feed" | "live";
  feedUrl: string | null;
  lastFetchedAt: string | null;
  lastItemCount: number | null;
  lastSkipped: { preorder: number; noImage: number; noPrice: number } | null;
  live: MetaLiveDto;
};

export type MetaConnectionTest =
  | { ok: true; catalogName: string }
  | {
      ok: false;
      kind: "throttle" | "auth" | "config" | "invalid" | "transient";
      pauseCode?: MetaPauseCode;
      message: string;
    };

export type MetaRejectedProduct = {
  productId: string;
  name: string;
  editPath: string;
  problems: Array<{ itemId: string; variant: string | null; message: string }>;
  failing: string | null;
};

export const META_CATALOG_ENDPOINT = "/api/admin/meta-catalog";

export async function metaRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    error?: string;
    message?: string;
  } | null;
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new Error(payload?.error || payload?.message || response.statusText);
  }
  return payload.data;
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
