import { PageEditorSkeleton } from "@/components/admin/online-store/online-store-skeletons";

// About Us splits its cards evenly (`xl:grid-cols-2`) rather than running a
// narrower side rail.
export default function AboutEditorLoading() {
  return <PageEditorSkeleton side="none" />;
}
