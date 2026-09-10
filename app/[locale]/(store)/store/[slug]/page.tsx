import { notFound, redirect } from "next/navigation";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";

interface LegacyVendorStorePageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function LegacyVendorStorePage({
  params,
  searchParams,
}: LegacyVendorStorePageProps) {
  const { locale, slug } = await params;
  const search = await searchParams;
  const multiVendorEnabled = await isMultiVendorEnabled();
  if (!multiVendorEnabled) notFound();

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") {
      query.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    }
  }

  const destination = `/${locale}/vendors/${slug}${
    query.toString() ? `?${query.toString()}` : ""
  }`;
  redirect(destination);
}
