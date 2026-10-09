import {
  productEditorDetailRoute,
  productEditorSaveRoute,
} from "@/lib/api-core/biz/products/editor-routes";
import { bizPrivateRoute } from "@/lib/api-next/routes";
export const GET = bizPrivateRoute(productEditorDetailRoute);
export const PATCH = bizPrivateRoute(productEditorSaveRoute);
