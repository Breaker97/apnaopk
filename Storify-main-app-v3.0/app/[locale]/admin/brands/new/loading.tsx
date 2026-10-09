import { BrandFormSkeleton } from "@/components/admin/brand-form-skeleton";

// Shadows admin/brands/loading.tsx, which would otherwise apply here and flash
// a list skeleton on the way to a form.
export default function AdminBrandNewLoading() {
  return <BrandFormSkeleton />;
}
