import {
  ContactMessageRequest,
  ContactMessageResult,
  ContactPage,
} from "@/contracts/mobile/shop/v1/content";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { sendContactMessage } from "@/lib/conversations/contact-message";
import { createChatGuestToken, hashChatGuestToken } from "@/lib/conversations/guest-session";
import { contactMapExternalUrl } from "@/lib/storefront/contact-map";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { shopperChatViewer } from "../chat/shopper-chat";
import { imageSet } from "../images";
import { pageNotFound, storeContact, words } from "./store-contact";

/** The website's own picture, when the merchant set none (app/[locale]/(store)/contact). */
const DEFAULT_HERO = "/contact-hero-storify.png";

/**
 * GET /contact: the website's /contact: its headings, the store's address
 * (opening the map), email, phone and hours, its social profiles when the
 * merchant shows them, the form's heading, and the map's link when the map is
 * shown. Hidden is not found. Static: expired by the settings tag.
 */
export const contactPageRoute = defineRoute({
  id: "content.contact",
  method: "GET",
  path: "/contact",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: ContactPage,
  handler: async () => {
    const settings = await getStorefrontSettings();
    const page = settings.contentPages.contact;
    if (!page.visible) throw pageNotFound();
    const address = words(settings.storeAddress) ?? "";

    return {
      title: page.title,
      description: words(page.description),
      image: imageSet(words(page.heroImageUrl) ?? DEFAULT_HERO),
      intro: { title: page.getInTouchTitle, text: words(page.getInTouchDescription) },
      details: storeContact(settings, { social: page.showSocialLinks }),
      form: { title: page.formTitle, text: words(page.formDescription) },
      map: page.showMap
        ? {
            title: page.mapTitle,
            text: words(page.mapDescription),
            label: words(page.mapButtonLabel),
            url: contactMapExternalUrl(page, address, settings.storeName),
          }
        : undefined,
    };
  },
});

/**
 * POST /contact/messages: the contact form, as the website's (app/api/contact)
 * takes it: the same fields and checks (`ContactMessageRequest`), five in
 * fifteen minutes, and the same service, which opens a conversation in the
 * store's inbox and emails the store.
 *
 * A signed-in shopper writes from their account, so the store's answer is in
 * their inbox; a guest writes as the website's guests do, one per app install
 * as the website keeps one per browser. The website's bot trap (a field
 * nobody sees) has no counterpart in an app; the limit stands in for it.
 */
export const contactMessageRoute = defineRoute({
  id: "content.contact.send",
  method: "POST",
  path: "/contact/messages",
  auth: "optional",
  cache: { kind: "private" },
  rateLimit: { bucket: "contact:send", preset: "strict" },
  demo: "default",
  idempotency: "required",
  input: ContactMessageRequest,
  output: ContactMessageResult,
  status: 201,
  handler: async ({ input, session, client }) => {
    await connectDB();
    const guestKey = client.installId ? `install:${client.installId}` : createChatGuestToken();
    const viewer = session
      ? shopperChatViewer(session)
      : ({ kind: "guest", guestKeyHash: hashChatGuestToken(guestKey) } as const);
    const { conversationId } = await sendContactMessage({ viewer, message: input });
    return session ? { conversationId } : {};
  },
});
