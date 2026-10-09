import { ThemeGallerySkeleton } from "@/components/admin/online-store/online-store-skeletons";

// Grouped away from `theme/editor`, which is a full-height workspace and
// carries its own placeholder.
export default function OnlineStoreThemeLoading() {
  return <ThemeGallerySkeleton />;
}
