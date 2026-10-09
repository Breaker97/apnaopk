import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { revalidateVendorStorePage } from "@/lib/vendors/vendor-store-page-read";
import {
  isInternalLink,
  normalizeVendorPageSettings,
  VENDOR_BANNER_SIZES,
  VENDOR_DEFAULT_SORTS,
  VENDOR_DEFAULT_TABS,
} from "@/lib/vendors/vendor-store-page";
import { VendorStorePage } from "@/models/vendor-store-page.model";

const HEX = z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.literal("")]);

/**
 * Every key is optional: a key left out keeps its saved value, so an older
 * editor that sends only the colour and the similar-products switch never
 * resets the rest. Lengths are bounded here; the normalizer trims and caps.
 */
const SettingsBodySchema = z.object({
  accentColor: HEX.optional(),
  showSimilarProducts: z.boolean().optional(),
  defaultTab: z.enum(VENDOR_DEFAULT_TABS).optional(),
  hideAboutTab: z.boolean().optional(),
  hideShippingTab: z.boolean().optional(),
  bannerSize: z.enum(VENDOR_BANNER_SIZES).optional(),
  defaultSort: z.enum(VENDOR_DEFAULT_SORTS).optional(),
  announcement: z
    .object({
      text: z.string().max(500),
      link: z
        .string()
        .max(500)
        .refine(isInternalLink, "The link must point to a page on this store, starting with /"),
      color: HEX,
      startsAt: z.string().max(40),
      endsAt: z.string().max(40),
    })
    .optional(),
  seo: z
    .object({
      title: z.string().max(300),
      description: z.string().max(1000),
      image: z.string().max(1000),
    })
    .optional(),
});

/**
 * The landing page's own settings: the accent colour, the similar-products
 * row, the tabs, the banner size, the Products tab's order, the Home tab's
 * announcement and the search preview. Not drafted — they apply to
 * /vendors/<slug> as soon as they are saved.
 */
export const PUT = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:settings" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const body = await validateBody(request, SettingsBodySchema);
    const current = await VendorStorePage.findOne({ vendorId: vendor._id })
      .select("settings")
      .lean();
    const saved = normalizeVendorPageSettings(current?.settings);
    const settings = normalizeVendorPageSettings({
      ...saved,
      ...Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== undefined),
      ),
    });

    await VendorStorePage.updateOne(
      { vendorId: vendor._id },
      {
        $set: { settings },
        $setOnInsert: { published: null, history: [] },
      },
      { upsert: true },
    );

    revalidateVendorStorePage(String(vendor._id));
    return successResponse({ settings });
  },
);
