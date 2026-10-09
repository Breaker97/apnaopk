import { mobileRouteNotFound } from "@/lib/api-next/routes";

// Any path under /api/mobile that no route file claims, by any method: the
// mobile contract's JSON 404 (ROUTE_NOT_FOUND). Next matches every real
// route before this one.
export const GET = mobileRouteNotFound;
export const POST = mobileRouteNotFound;
export const PUT = mobileRouteNotFound;
export const PATCH = mobileRouteNotFound;
export const DELETE = mobileRouteNotFound;
