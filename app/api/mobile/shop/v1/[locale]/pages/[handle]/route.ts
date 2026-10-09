import { contentPageRoute } from "@/lib/api-core/shop/content/pages";
import { staticGet } from "@/lib/api-next/routes";

// Static (ISR): GET and nothing else in this file (lib/api-next/routes.ts).
export const revalidate = 60;
export async function generateStaticParams() {
  return [];
}
export const GET = staticGet(contentPageRoute);
