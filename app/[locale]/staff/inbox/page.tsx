import { Inbox } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConversationInbox } from "@/components/chat/inbox/conversation-inbox";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { listConversations } from "@/lib/conversations/service";
import { tryResolveConversationViewer } from "@/lib/conversations/viewer";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StaffInboxPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const chatT = await getTranslations({ locale, namespace: "chat" });
  const chatLabel = (key: string, fallback: string) =>
    chatT.has(key) ? chatT(key as never) : fallback;
  const { session } = await requireStaffAreaAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.VIEW_INBOX,
      STAFF_PERMISSIONS.REPLY_INBOX,
      STAFF_PERMISSIONS.MANAGE_INBOX,
    ],
    mode: "any",
  });
  const viewer = await tryResolveConversationViewer({ session });
  const conversations = viewer
    ? (await listConversations({ viewer, limit: 100 })).conversations
    : [];

  return (
    <div className="flex min-h-0 flex-col gap-4 [--inbox-offset:7.5rem]">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Inbox className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {chatLabel("inbox.staffHeading", "Customer inbox")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {chatLabel(
              "inbox.staffSubtitle",
              "Reply to conversations for the vendors assigned to you.",
            )}
          </p>
        </div>
      </div>

      <ConversationInbox
        locale={locale}
        viewerMode="store"
        title={chatLabel("inbox.staffTitle", "Team inbox")}
        emptyTitle={chatLabel(
          "inbox.emptyStore",
          "No customer conversations yet",
        )}
        initialConversations={conversations}
        initialSelectedConversationId={
          typeof search.conversation === "string"
            ? search.conversation
            : undefined
        }
      />
    </div>
  );
}
