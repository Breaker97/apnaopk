import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isStorefrontMultiVendorEnabled } from "@/lib/catalog/product-visibility";

// A single-vendor store has no marketplace to browse, so the directory answers
// 404 — from here, above the page's loading boundary, for the reason given in
// lib/storefront/resource-gate.ts.
export default async function VendorDirectoryLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await isStorefrontMultiVendorEnabled())) notFound();
  return children;
}
