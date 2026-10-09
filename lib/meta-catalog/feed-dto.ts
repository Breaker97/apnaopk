import "server-only";

import {
  metaCatalogFeedUrl,
  type MetaCatalogFeedState,
  type MetaCatalogSkipCounts,
} from "@/lib/meta-catalog/feed-state";

/** What the admin page is told about the feed. The token only inside the URL. */
export type MetaCatalogFeedDto = {
  enabled: boolean;
  source: MetaCatalogFeedState["source"];
  feedUrl: string | null;
  lastFetchedAt: string | null;
  lastItemCount: number | null;
  lastSkipped: MetaCatalogSkipCounts | null;
};

export function toMetaCatalogFeedDto(state: MetaCatalogFeedState): MetaCatalogFeedDto {
  return {
    enabled: state.enabled,
    source: state.source,
    feedUrl: state.token ? metaCatalogFeedUrl(state.token) : null,
    lastFetchedAt: state.lastFetchedAt?.toISOString() ?? null,
    lastItemCount: state.lastItemCount,
    lastSkipped: state.lastSkipped,
  };
}
