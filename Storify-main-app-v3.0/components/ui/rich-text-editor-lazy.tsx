"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `RichTextEditor` behind a dynamic import.
 *
 * The editor carries TipTap + ProseMirror (~280 KB of JS). Importing it
 * statically put all of that in the first load of every admin form that has a
 * description field — product, blog post, custom pages — before the operator
 * had clicked into the editor at all. Loading it on demand keeps those forms'
 * first paint to the fields themselves; the editor never renders on the
 * server anyway (`ssr: false` matches what the component already assumed).
 */
export const RichTextEditor = dynamic(
  () =>
    import("@/components/ui/rich-text-editor").then(
      (module) => module.RichTextEditor,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full rounded-md" />,
  },
);
