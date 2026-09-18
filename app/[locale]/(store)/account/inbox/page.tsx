import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth/auth";
import { ConversationInbox } from "@/components/chat/inbox/conversation-inbox";
import { connectDB } from "@/lib/db";
import {
  listConversations,
  previewConversationTarget,
} from "@/lib/conversations/service";
import { tryResolveConversationViewer } from "@/lib/conversations/viewer";
import { buildLoginUrl } from "@/lib/auth/return-path";

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

  const session = await auth.api.getSession({ headers: await headers() });
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
      buildLoginUrl(
        locale,
        `/${locale}/account/inbox${query ? `?${query}` : ""}`,
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
  // storefront — with only the vendor. Reopen the matching thread when there is
  // one; otherwise hand the context to the inbox as a draft so the first message
  // creates the thread.
  const requestedProductId =
    typeof search.product === "string" ? search.product : undefined;
  const requestedVendorId =
    typeof search.vendor === "string" ? search.vendor : undefined;
  const existingContextConversation = requestedProductId
    ? chatConversations.find(
        (conversation) =>
          conversation.productContext?.productId === requestedProductId &&
          (requestedVendorId
            ? conversation.ownerVendorId === requestedVendorId
            : conversation.ownerType === "platform"),
      )
    : requestedVendorId
      ? // Store-level thread with this vendor: the one without product context,
        // so a "chat with the store" click never reopens a product question.
        chatConversations.find(
          (conversation) =>
            conversation.ownerVendorId === requestedVendorId &&
            !conversation.productContext,
        )
      : undefined;
  const requestedVariantId =
    typeof search.variant === "string" ? search.variant : undefined;
  const draftContext =
    (requestedProductId || requestedVendorId) && !existingContextConversation
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

  return (
    <div className="flex flex-col gap-4 [--inbox-offset:11rem]">
      <div className="shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("subtitle")}
        </p>
      </div>

      <ConversationInbox
        locale={locale}
        viewerMode="customer"
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
      />
    </div>
  );
}
