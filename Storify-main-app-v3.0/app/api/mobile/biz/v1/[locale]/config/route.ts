import { bizConfigRoute } from "@/lib/api-core/biz/config/config";
import { bizStaticGet } from "@/lib/api-next/routes";

// Static (ISR): GET and nothing else in this file (lib/api-next/routes.ts).
export const revalidate = 60;
export async function generateStaticParams() {
  return [];
}
export const GET = bizStaticGet(bizConfigRoute);
