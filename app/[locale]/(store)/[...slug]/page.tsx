import { notFound } from "next/navigation";

// This catch-all route handles any unmatched routes within the store layout
// and triggers the store not-found.tsx to render within the store layout
export default function StoreCatchAllPage() {
  notFound();
}
