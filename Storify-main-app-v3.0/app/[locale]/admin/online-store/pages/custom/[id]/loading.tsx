import { PageEditorSkeleton } from "@/components/admin/online-store/online-store-skeletons";

// The edit form adds Preview and Delete to the create form's bar.
export default function EditCustomPageLoading() {
  return <PageEditorSkeleton side="narrow" mainCards={1} actions={4} />;
}
