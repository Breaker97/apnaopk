import { PageEditorSkeleton } from "@/components/admin/online-store/online-store-skeletons";

// Creating a page: one content card beside the settings rail, and only Save
// and Cancel in the bar.
export default function NewCustomPageLoading() {
  return <PageEditorSkeleton side="narrow" mainCards={1} actions={2} />;
}
