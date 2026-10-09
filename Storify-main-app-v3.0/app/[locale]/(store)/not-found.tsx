"use client";

import dynamic from "next/dynamic";

// Every storefront page carries its not-found boundary, so the page itself —
// illustration, search, links, 15 KB — is loaded only when one is rendered:
// on the server for a missing URL (and preloaded with its HTML), on demand
// after a client navigation to one.
const StoreNotFound = dynamic(() =>
  import("@/components/errors/store-not-found").then(
    (module) => module.StoreNotFound,
  ),
);

export default function StoreNotFoundPage() {
  return <StoreNotFound />;
}
