import { NavigationHubSkeleton } from "@/components/admin/online-store/online-store-skeletons";

// Scoped to the route group so the hub cards do not flash ahead of the header
// studio, the footer builder or the mega-menu form.
export default function OnlineStoreMenusLoading() {
  return <NavigationHubSkeleton />;
}
