import { notFound } from "next/navigation";

// This catch-all route handles any unmatched routes within the vendor layout
// and triggers the vendor not-found.tsx to render within the vendor layout
export default function VendorCatchAllPage() {
  notFound();
}
