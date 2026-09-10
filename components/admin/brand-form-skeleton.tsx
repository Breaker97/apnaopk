import { AdminFormSkeleton } from "@/components/admin/admin-form-skeleton";

interface BrandFormSkeletonProps {
  /** Vendors get a "Review status" copy card where admins get the controls. */
  area?: "admin" | "vendor";
}

/**
 * Placeholder for `BrandForm`. Kept outside the form so the create/edit route
 * segments can render it from their own `loading.tsx` — see
 * [category-form-skeleton] for why those files are required.
 */
export function BrandFormSkeleton({ area = "admin" }: BrandFormSkeletonProps) {
  return (
    <AdminFormSkeleton
      // Outer `space-y-6`, body grid `gap-4` with `space-y-4` columns.
      spacing="6"
      gridSpacing="4"
      headerActions={2}
      badges={1}
      mainCards={[
        {
          titleWidth: "w-20",
          blocks: [
            { type: "field", labelWidth: "w-16" },
            { type: "textareaWithAction", lines: 4, labelWidth: "w-24" },
            { type: "field", labelWidth: "w-20" },
            // The website field's helper line.
            { type: "block", height: "h-4" },
          ],
        },
        {
          titleWidth: "w-16",
          blocks: [
            // Taller than the default: on edit the uploader also renders the
            // existing logo above its drop area.
            { type: "dropzone", height: "h-48" },
            { type: "block", height: "h-10" },
          ],
        },
        { titleWidth: "w-48", description: true, blocks: [{ type: "seo" }] },
      ]}
      sideCards={[
        area === "vendor"
          ? {
              titleWidth: "w-28",
              // A 3-4 sentence paragraph in the narrow column, so it wraps to
              // roughly eight lines.
              blocks: [{ type: "block", height: "h-32" }],
            }
          : {
              titleWidth: "w-16",
              blocks: [
                { type: "field", labelWidth: "w-16" },
                { type: "toggle" },
              ],
            },
        {
          titleWidth: "w-28",
          blocks: [{ type: "field", labelWidth: "w-24" }, { type: "stat" }],
        },
      ]}
    />
  );
}
