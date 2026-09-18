import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import {
  resolveIotecCredentials,
  resolveMtnMomoCredentials,
  resolveOrangeMoneyCredentials,
  resolvePayPalCredentials,
  resolvePaystackCredentials,
  resolvePesapalCredentials,
  resolveRazorpayCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { getSettings, type ISettings } from "@/models/settings.model";
import {
  buildAgentStoreContext,
  buildKnowledgeChunks,
  flattenCategoryDirectory,
  type AgentCategory,
  type AgentStoreContext,
  type KnowledgeChunk,
  type PaymentMethodId,
} from "./store-knowledge";

/**
 * The store facts the agent reads, cached. The shaping is in
 * `store-knowledge.ts`; this file only knows where the data lives and how
 * long it may be kept. Everything is tagged with the settings tag, so an
 * admin save is visible to the agent on its next turn.
 */

/** The category directory rides on the storefront's cached tree. */
export async function getAgentCategoryDirectory(): Promise<AgentCategory[]> {
  const { categories } = await getStorefrontCategories();
  return flattenCategoryDirectory(categories);
}

/**
 * The methods checkout will actually offer: switched on AND holding a
 * credential (from settings or the environment). "Enabled" alone would let
 * the agent promise PayPal on a store whose PayPal has no client id.
 */
function enabledPaymentMethods(settings: ISettings): PaymentMethodId[] {
  const payment = settings.payment;
  const usable: Record<PaymentMethodId, boolean> = {
    card: Boolean(
      payment?.stripe?.enabled && resolveStripeCredentials(payment.stripe).secretKey,
    ),
    paypal: Boolean(
      payment?.paypal?.enabled && resolvePayPalCredentials(payment.paypal).clientId,
    ),
    razorpay: Boolean(
      payment?.razorpay?.enabled &&
        resolveRazorpayCredentials(payment.razorpay).keyId,
    ),
    paystack: Boolean(
      payment?.paystack?.enabled &&
        resolvePaystackCredentials(payment.paystack).secretKey,
    ),
    pesapal: Boolean(
      payment?.pesapal?.enabled &&
        resolvePesapalCredentials(payment.pesapal).consumerKey,
    ),
    iotec: Boolean(
      payment?.iotec?.enabled && resolveIotecCredentials(payment.iotec).clientId,
    ),
    orange_money: Boolean(
      payment?.orange_money?.enabled &&
        resolveOrangeMoneyCredentials(payment.orange_money).clientId,
    ),
    mtn_momo: Boolean(
      payment?.mtn_momo?.enabled &&
        resolveMtnMomoCredentials(payment.mtn_momo).subscriptionKey,
    ),
    // Same default the storefront applies: cash on delivery is on until
    // switched off.
    cod: payment?.cod?.enabled ?? true,
  };
  return (Object.keys(usable) as PaymentMethodId[]).filter((id) => usable[id]);
}

export const getAgentStoreContext = unstable_cache(
  async (): Promise<AgentStoreContext> => {
    await connectDB();
    const [settings, storefront] = await Promise.all([
      getSettings(),
      getStorefrontSettings(),
    ]);
    const contact = storefront.contentPages.contact;
    const supportHours =
      contact?.visible && contact.supportHours?.trim()
        ? contact.supportHours.trim()
        : undefined;

    return buildAgentStoreContext({
      store: {
        name: storefront.storeName,
        currency: settings.general?.defaultCurrency?.trim() || "USD",
        ...(storefront.storeEmail ? { email: storefront.storeEmail } : {}),
        ...(storefront.storePhone ? { phone: storefront.storePhone } : {}),
        ...(storefront.storeAddress ? { address: storefront.storeAddress } : {}),
        ...(supportHours ? { supportHours } : {}),
      },
      enabledPaymentMethods: enabledPaymentMethods(settings),
      cashOnDelivery: settings.payment?.cod ?? null,
      shipping: settings.shipping ?? null,
      contentPages: storefront.contentPages,
    });
  },
  ["ai-sales-agent-store-context"],
  { revalidate: 300, tags: [CACHE_TAGS.settings] },
);

export const getAgentKnowledgeChunks = unstable_cache(
  async (): Promise<KnowledgeChunk[]> => {
    const { contentPages, storeName } = await getStorefrontSettings();
    return buildKnowledgeChunks(contentPages, storeName);
  },
  ["ai-sales-agent-knowledge"],
  { revalidate: 300, tags: [CACHE_TAGS.settings] },
);
