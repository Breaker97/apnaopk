import { CollectionFormSkeleton } from "@/components/admin/collection-form-skeleton";

// Shadows admin/collections/loading.tsx, which would otherwise apply here and
// flash a list skeleton on the way to a form.
export default function AdminCollectionNewLoading() {
  return <CollectionFormSkeleton />;
}
