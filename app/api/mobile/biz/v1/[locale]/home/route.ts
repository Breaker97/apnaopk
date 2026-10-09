import { homeRoute } from "@/lib/api-core/biz/home/home";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(homeRoute);
