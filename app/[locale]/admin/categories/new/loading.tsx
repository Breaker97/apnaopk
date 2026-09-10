import { CategoryFormSkeleton } from "@/components/admin/category-form-skeleton";

// Shadows admin/categories/loading.tsx, which would otherwise apply here and
// flash a list skeleton on the way to a form.
export default function AdminCategoryNewLoading() {
  return <CategoryFormSkeleton />;
}
