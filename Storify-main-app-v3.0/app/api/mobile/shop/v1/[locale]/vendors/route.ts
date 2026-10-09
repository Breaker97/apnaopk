import { vendorListRoute } from "@/lib/api-core/shop/catalog/vendors";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(vendorListRoute);
