import { searchStartRoute } from "@/lib/api-core/shop/search/start";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(searchStartRoute);
