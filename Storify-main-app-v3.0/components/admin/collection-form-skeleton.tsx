import { AdminFormSkeleton } from "@/components/admin/admin-form-skeleton";

/**
 * Placeholder for `CollectionForm`. Kept outside the form so the create/edit
 * route segments can render it from their own `loading.tsx` — see
 * [category-form-skeleton] for why those files are required.
 */
export function CollectionFormSkeleton() {
  return (
    <AdminFormSkeleton
      // This form is `gap-6` / `space-y-6` throughout, unlike its siblings.
      spacing="6"
      headerActions={2}
      // The header carries a description line instead of status badges.
      badges={0}
      headerDescription
      mainCards={[
        {
          titleWidth: "w-40",
          description: true,
          blocks: [
            { type: "field", labelWidth: "w-12" },
            { type: "textareaWithAction", lines: 4, labelWidth: "w-20" },
            { type: "dropzone" },
          ],
        },
        {
          titleWidth: "w-32",
          description: true,
          blocks: [{ type: "tiles" }],
        },
        {
          // Stands in for whichever type-dependent card follows: the product
          // picker (search box over the selected list) is the default, and the
          // condition builder occupies roughly the same box.
          titleWidth: "w-44",
          blocks: [
            { type: "block", height: "h-9" },
            { type: "block", height: "h-40" },
          ],
        },
        { titleWidth: "w-48", blocks: [{ type: "seo" }] },
      ]}
      sideCards={[
        { titleWidth: "w-16", blocks: [{ type: "block", height: "h-9" }] },
        {
          titleWidth: "w-24",
          blocks: [{ type: "toggle" }, { type: "toggle" }],
        },
        { titleWidth: "w-24", blocks: [{ type: "block", height: "h-9" }] },
        { titleWidth: "w-32", blocks: [{ type: "field", labelWidth: "w-28" }] },
      ]}
    />
  );
}
