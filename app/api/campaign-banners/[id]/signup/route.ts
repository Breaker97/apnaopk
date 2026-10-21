import { USER_ROLES } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { getClientIP } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import { signUpThroughCampaignBanner } from "@/lib/campaign-banners/signup";
import { CampaignBannerSignupSchema } from "@/lib/validations";

/**
 * A visitor's email through a Campaign Banner's signup form. Public, so it is
 * rate limited per address of origin, answers a filled honeypot as if it had
 * worked, and refuses on a demo site (it sends email).
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "campaign-banners:signup", preset: "strict" },
    demo: "block-mutations",
  },
  async ({ request, params, session }) => {
    const parsed = CampaignBannerSignupSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError({ email: ["Enter a valid email address"] });
    }
    const { email, locale, website } = parsed.data;

    // The hidden field: a person never fills it. Look like success, do nothing.
    if (website) return successResponse({ couponCode: "" });

    const signedIn =
      session?.user.role === USER_ROLES.CUSTOMER &&
      session.user.email.toLowerCase() === email;
    const result = await signUpThroughCampaignBanner({
      bannerId: params.id,
      email,
      userId: signedIn ? session.user.id : null,
      ip: getClientIP(request),
      locale,
    });
    return successResponse(result);
  },
);
