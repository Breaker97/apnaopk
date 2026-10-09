import { bizMePictureRemoveRoute, bizMePictureUpdateRoute } from "@/lib/api-core/biz/me/picture";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const PUT = bizPrivateRoute(bizMePictureUpdateRoute);
export const DELETE = bizPrivateRoute(bizMePictureRemoveRoute);
