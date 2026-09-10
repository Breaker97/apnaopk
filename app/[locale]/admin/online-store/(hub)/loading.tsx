import { OnlineStoreHubSkeleton } from "@/components/admin/online-store/online-store-skeletons";

// Scoped to the route group so the hub's card grid is not also painted as the
// first frame of Customize, Themes, Pages and every other nested screen.
export default function OnlineStoreLoading() {
  return <OnlineStoreHubSkeleton />;
}
