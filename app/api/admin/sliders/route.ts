import { Slider } from "@/models";
import {
  successResponse,
  createdResponse,
} from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { sanitizeSearchString } from "@/lib/api/validate";
import { CreateSliderSchema } from "@/lib/validations";
import { normalizeSlides } from "@/lib/sliders/types";
import { revalidateSliderContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { slugify } from "@/lib/strings";

/**
 * Admin-managed reusable sliders (the Menus precedent). The storefront never
 * reads this API — sections resolve sliders server-side through
 * `lib/storefront/sliders.ts` — so every verb is admin-gated.
 */
export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const sp = request.nextUrl.searchParams;
  const search = sanitizeSearchString(sp.get("search") || "");
  const query: Record<string, unknown> = {};
  if (search) query.name = { $regex: search, $options: "i" };
  // A store has at most a handful of sliders; 200 bounds the worst case.
  const items = await Slider.find(query)
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  return successResponse(items);
});

export const POST = withApi({ auth: "admin" }, async ({ request }) => {
  const body = await request.json();
  const parsed = CreateSliderSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid slider payload");
  }
  const data = parsed.data;
  let handle = slugify(data.handle || data.name);
  if (!handle) handle = "slider";
  const exists = await Slider.findOne({ handle });
  if (exists) handle = `${handle}-${Date.now()}`;
  const slider = await Slider.create({
    ...data,
    handle,
    slides: normalizeSlides(data.slides),
  });
  revalidateSliderContent();
  return createdResponse(slider);
});
