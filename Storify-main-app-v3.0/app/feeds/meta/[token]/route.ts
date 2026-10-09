import { getClientIP, countRequest } from "@/lib/api/rate-limit-middleware";
import {
  META_FEED_TOKEN_PATTERN,
  isMetaFeedServed,
  metaFeedTokenMatches,
  readMetaCatalogFeed,
  recordMetaCatalogFetch,
} from "@/lib/meta-catalog/feed-state";
import { loadMetaFeedSetup, renderMetaFeed } from "@/lib/meta-catalog/feed-source";

/**
 * The product feed Meta Commerce Manager fetches on a schedule:
 * `/feeds/meta/<token>.xml`, RSS 2.0 with the `g:` namespace.
 *
 * Outside `/api` and dotted, so the proxy leaves it alone (no locale rewrite,
 * no maintenance page). Only the token in the path admits a reader; a wrong
 * one, or a feed that is switched off, is a plain 404 that says nothing about
 * which. Streamed in batches and never cached here: a catalogue of any size
 * costs one batch of memory, and a new URL or a switch-off holds at once.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function notFound() {
  return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const match = /^(.+)\.xml$/.exec((await params).token);
  const token = match?.[1];
  if (!token || !META_FEED_TOKEN_PATTERN.test(token)) return notFound();

  // Counted before the token is checked, so guessing costs the same as
  // fetching. Meta reads the feed once an hour; 20 reads in 15 minutes from
  // one address is far past that and still lets a merchant open it to look.
  const refusal = await countRequest(
    `ip:${getClientIP(request)}:meta-catalog-feed`,
    "moderate",
  );
  if (refusal) {
    return new Response("Too many requests", {
      status: 429,
      headers: {
        ...NOT_FOUND_HEADERS,
        "Retry-After": String(refusal.resetIn),
      },
    });
  }

  const feed = await readMetaCatalogFeed();
  // Live sync is the catalog's one source while it is chosen: Meta reading
  // the feed too would have two sources writing every item.
  if (!isMetaFeedServed(feed) || !metaFeedTokenMatches(feed.token, token)) return notFound();

  let setup;
  try {
    setup = await loadMetaFeedSetup();
  } catch (error) {
    console.error("Meta catalog feed: could not read the store", error);
    // Not an empty feed: Meta replaces the catalogue with what it is given,
    // and an empty answer to a database blip would delete every item.
    return new Response("Feed temporarily unavailable", {
      status: 503,
      headers: { ...NOT_FOUND_HEADERS, "Retry-After": "300" },
    });
  }

  const chunks = renderMetaFeed({
    token,
    setup,
    onComplete: (stats) => recordMetaCatalogFetch(token, stats),
  });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    // Pulled, so a slow reader slows the database reads instead of the
    // server buffering the catalogue ahead of it.
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        console.error("Meta catalog feed: failed part-way", error);
        // Broken off, never closed: a document that ends early but parses
        // would be read as the whole catalogue, and every item after the
        // failure deleted from it.
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
