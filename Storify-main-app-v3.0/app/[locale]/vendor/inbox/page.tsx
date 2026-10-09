import { Inbox } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConversationInbox } from "@/components/chat/inbox/conversation-inbox";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { listConversations } from "@/lib/conversations/service";
import { tryResolveConversationViewer } from "@/lib/conversations/viewer";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VendorInboxPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const chatT = await getTranslations({ locale, namespace: "chat" });
  const chatLabel = (key: string, fallback: string) =>
    chatT.has(key) ? chatT(key as never) : fallback;

  const { session } = await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.VIEW_INBOX,
      VENDOR_PERMISSIONS.REPLY_INBOX,
      VENDOR_PERMISSIONS.MANAGE_INBOX,
    ],
    mode: "any",
  });
  const viewer = await tryResolveConversationViewer({ session });
  const conversations = viewer
    ? (await listConversations({ viewer, limit: 100 })).conversations
    : [];
  const selectedConversationId =
    typeof search.conversation === "string" ? search.conversation : undefined;

  return (
    <div className="flex min-h-0 flex-col gap-4 [--inbox-offset:7.5rem]">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Inbox className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {chatLabel("messages", "Messages")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {chatLabel(
              "inbox.vendorSubtitle",
              "Reply to customers across your connected channels.",
            )}
          </p>
        </div>
      </div>

      <ConversationInbox
        locale={locale}
        viewerMode="store"
        title={chatLabel("inbox.vendorTitle", "Vendor inbox")}
        emptyTitle={chatLabel(
          "inbox.emptyStore",
          "No customer conversations yet",
        )}
        initialConversations={conversations}
        initialSelectedConversationId={selectedConversationId}
      />
    </div>
  );
}
