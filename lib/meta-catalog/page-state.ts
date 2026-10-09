import "server-only";

import { toMetaCatalogFeedDto } from "@/lib/meta-catalog/feed-dto";
import { readMetaCatalogFeed, type MetaCatalogFeedState } from "@/lib/meta-catalog/feed-state";
import { toMetaCatalogLiveDto } from "@/lib/meta-catalog/live-dto";

/** What every Settings → Meta catalog route answers with: the switch, the source, the feed, the live sync. */
export async function metaCatalogPageState(feed?: MetaCatalogFeedState) {
  const state = feed ?? (await readMetaCatalogFeed());
  return { ...toMetaCatalogFeedDto(state), live: await toMetaCatalogLiveDto() };
}

export type MetaCatalogPageState = Awaited<ReturnType<typeof metaCatalogPageState>>;
