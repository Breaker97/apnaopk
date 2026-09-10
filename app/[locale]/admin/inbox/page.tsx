import { Inbox, Settings2 } from "lucide-react";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { ConversationInbox } from "@/components/chat/inbox/conversation-inbox";
import { Button } from "@/components/ui/button";
import { connectDB } from "@/lib/db";
import { listConversations } from "@/lib/conversations/service";
import { tryResolveConversationViewer } from "@/lib/conversations/viewer";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminInboxPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const session = await requireAdminPageAccess(locale);
  const t = await getTranslations({ locale, namespace: "admin.inboxPage" });
  const chatT = await getTranslations({ locale, namespace: "chat" });
  const chatLabel = (key: string, fallback: string) =>
    chatT.has(key) ? chatT(key as never) : fallback;
  const selectedConversationId =
    typeof search.conversation === "string" ? search.conversation : undefined;

  await connectDB();
  const viewer = await tryResolveConversationViewer({ session });
  const conversations = viewer
    ? (await listConversations({ viewer, limit: 100 })).conversations
    : [];

  return (
    <div className="flex min-h-0 flex-col gap-4 [--inbox-offset:7.5rem]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Inbox className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/${locale}/admin/settings/messaging`}>
            <Settings2 />
            {chatLabel("channels", "Channels")}
          </Link>
        </Button>
      </div>

      <ConversationInbox
        locale={locale}
        viewerMode="store"
        title={chatLabel("inbox.adminTitle", "All conversations")}
        emptyTitle={chatLabel("inbox.emptyLiveChat", "No conversations yet")}
        initialConversations={conversations}
        initialSelectedConversationId={selectedConversationId}
      />
    </div>
  );
}
