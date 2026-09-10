import { notFound } from "next/navigation";

// This catch-all route handles any unmatched routes within the admin layout
// and triggers the admin not-found.tsx to render within the admin layout
export default function AdminCatchAllPage() {
  notFound();
}
