import { blogListRoute } from "@/lib/api-core/shop/content/blog";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(blogListRoute);
