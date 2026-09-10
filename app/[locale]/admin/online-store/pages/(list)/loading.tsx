import { PagesManagerSkeleton } from "@/components/admin/online-store/online-store-skeletons";

// Scoped to the route group: the page editors below `pages/` are forms, not
// this list, and each brings its own placeholder.
export default function OnlineStorePagesLoading() {
  return <PagesManagerSkeleton />;
}
