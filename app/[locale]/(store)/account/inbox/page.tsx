import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RouteMessages } from "@/components/language/route-messages";
import { getAccountSession } from "@/lib/customers/account-data";
import { ConversationInbox } from "@/components/chat/inbox/conversation-inbox";
import { connectDB } from "@/lib/db";
import {
  listConversations,
  previewConversationTarget,
} from "@/lib/conversations/service";
import { tryResolveConversationViewer } from "@/lib/conversations/viewer";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { localeHref } from "@/lib/i18n/locale-routing";
import { brandIconUrl, resolveBrand } from "@/lib/branding/brand";
import { getSettingsLean } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function CustomerInboxPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  // Shared with the account layout's lookup for this request.
  const session = await getAccountSession();
  if (!session) {
    // Preserve the product context a storefront chat button may have attached,
    // so signing in lands the shopper back on the exact thread they wanted.
    const returnTo = new URLSearchParams();
    for (const key of ["product", "vendor", "variant", "variantName"]) {
      const value = search[key];
      if (typeof value === "string") returnTo.set(key, value);
    }
    const query = returnTo.toString();
    redirect(
      await localeHref(
        locale,
        buildLoginUrl(locale, `/account/inbox${query ? `?${query}` : ""}`),
      ),
    );
  }

  const t = await getTranslations({ locale, namespace: "account.inbox" });
  const chatT = await getTranslations({ locale, namespace: "chat" });
  const chatLabel = (key: string, fallback: string) =>
    chatT.has(key) ? chatT(key as never) : fallback;
  const selectedConversationId =
    typeof search.conversation === "string" ? search.conversation : undefined;
  await connectDB();
  const viewer = await tryResolveConversationViewer({ session });
  const chatConversations = viewer
    ? (await listConversations({ viewer, limit: 100 })).conversations
    : [];

  // A storefront chat button arrives with product context, or — from a vendor
  // storefront — with only the vendor. A shopper has one thread per store, so
  // the store's thread is reopened when there is one, with the product staged
  // in its composer; otherwise the context becomes a draft and the first
  // message creates the thread.
  const requestedProductId =
    typeof search.product === "string" ? search.product : undefined;
  const requestedVendorId =
    typeof search.vendor === "string" ? search.vendor : undefined;
  // The same thread the start endpoint files a message under: the latest live
  // chat with this store that is not closed (the list is newest first).
  const existingContextConversation =
    requestedProductId || requestedVendorId
      ? chatConversations.find(
          (conversation) =>
            conversation.channel === "live_chat" &&
            ["open", "pending", "resolved"].includes(conversation.status) &&
            (requestedVendorId
              ? conversation.ownerVendorId === requestedVendorId
              : conversation.ownerType === "platform"),
        )
      : undefined;
  const requestedVariantId =
    typeof search.variant === "string" ? search.variant : undefined;
  const draftContext =
    requestedProductId || (requestedVendorId && !existingContextConversation)
      ? {
          productId: requestedProductId,
          vendorId: requestedVendorId,
          variantId: requestedVariantId,
          variantName:
            typeof search.variantName === "string"
              ? search.variantName
              : undefined,
          // The seller and product the shopper came from, shown before the
          // first message so they can see what they are asking about.
          preview: await previewConversationTarget({
            productId: requestedProductId,
            vendorId: requestedVendorId,
            variantId: requestedVariantId,
          }),
        }
      : undefined;

  // The avatar of the store's own threads ("Store support"): the brand's
  // square mark, else its logo.
  const brandAssets = resolveBrand(await getSettingsLean()).assets;
  const platformImage =
    brandIconUrl(brandAssets) || brandAssets.logoUrl || undefined;

  return (
    <div className="flex flex-col gap-4 [--inbox-offset:7.5rem]">
      <div className="shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("subtitle")}
        </p>
      </div>

      {/* The inbox is the one storefront screen that needs every `chat`
          string; the bundle other storefront pages ship carries a few. */}
      <RouteMessages namespaces={["chat"]}>
        <ConversationInbox
          locale={locale}
          viewerMode="customer"
          platformImage={platformImage}
          title={chatLabel("inbox.customerTitle", "Store conversations")}
          emptyTitle={chatLabel(
            "inbox.emptyCustomer",
            "You have not started a conversation yet",
          )}
          initialConversations={chatConversations}
          initialSelectedConversationId={
            existingContextConversation?._id || selectedConversationId
          }
          draftContext={draftContext}
          draftConversationId={
            draftContext ? existingContextConversation?._id : undefined
          }
        />
      </RouteMessages>
    </div>
  );
}
