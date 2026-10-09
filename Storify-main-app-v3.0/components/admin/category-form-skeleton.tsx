import { AdminFormSkeleton } from "@/components/admin/admin-form-skeleton";

/**
 * Placeholder for `CategoryForm`.
 *
 * Lives outside the form so `loading.tsx` in the create/edit route segments can
 * render the same shape. Without those files the parent
 * `admin/categories/loading.tsx` would apply — Next uses a segment's loading
 * boundary for its whole subtree — and the form routes would flash a *list*
 * skeleton before this one.
 */
export function CategoryFormSkeleton() {
  return (
    <AdminFormSkeleton
      // The form is `space-y-6` on the outside but its body grid is `gap-4`
      // with `space-y-4` columns.
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
          ],
        },
        { titleWidth: "w-16", blocks: [{ type: "dropzone" }] },
        {
          titleWidth: "w-12",
          blocks: [
            { type: "dropzone" },
            // Stands in for the icon field's two-line helper text.
            { type: "block", height: "h-8" },
          ],
        },
        { titleWidth: "w-20", blocks: [{ type: "block", height: "h-8" }] },
        {
          titleWidth: "w-48",
          description: true,
          blocks: [
            { type: "seo" },
            // This card also carries a tags input and a collapsed SEO
            // checklist, which the shared `seo` block does not model.
            { type: "field", labelWidth: "w-12" },
            { type: "block", height: "h-11" },
          ],
        },
      ]}
      sideCards={[
        {
          titleWidth: "w-16",
          blocks: [{ type: "field", labelWidth: "w-16" }, { type: "toggle" }],
        },
        {
          titleWidth: "w-28",
          blocks: [
            { type: "field", labelWidth: "w-28" },
            { type: "field", labelWidth: "w-24" },
            // Product count only ever renders on edit, which is the only path
            // that reaches this placeholder.
            { type: "stat" },
          ],
        },
      ]}
    />
  );
}
