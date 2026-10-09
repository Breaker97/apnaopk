"use client";

import { useEffect } from "react";

export function BlogPostViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    const url = `/api/blog-posts/slug/${encodeURIComponent(slug)}/view`;
    void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }, [slug]);

  return null;
}
