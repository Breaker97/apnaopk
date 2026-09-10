"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle,
  CreditCard,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ShieldAlert,
  ShoppingBag,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient } from "@/lib/api/client";
import type { OrderTimelineEntry } from "@/lib/orders/order-details";

interface OrderTimelineFeedProps {
  orderId: string;
  entries: OrderTimelineEntry[];
  /** Staff with EDIT_ORDERS/MANAGE_ORDERS may post. */
  canComment?: boolean;
  /** Staff with DELETE_ORDERS/MANAGE_ORDERS may remove other people's. */
  canModerate?: boolean;
  /** Decides which comments show an Edit action — authors only. */
  currentUserId?: string;
}

/**
 * One icon per event class. Money moving (payment green, refund red) has to be
 * distinguishable at a glance from an ordinary field edit — that is most of
 * what makes a timeline scannable rather than a wall of identical rows.
 */
function getIcon(action?: string, status?: string) {
  // A cancellation is a STATUS_CHANGE like any other, so it would otherwise
  // get the same green check as "shipped".
  if (status === "cancelled") {
    return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  }

  switch (action) {
    case "CREATE":
      return <ShoppingBag className="h-3.5 w-3.5 text-blue-500" />;
    case "PAYMENT":
      return <CreditCard className="h-3.5 w-3.5 text-green-600" />;
    case "REFUND":
      return <RotateCcw className="h-3.5 w-3.5 text-red-500" />;
    case "STATUS_CHANGE":
      return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    // Amber, and deliberately not the green check a normal transition gets:
    // someone stepped outside the workflow here, and the row should say so at
    // a glance rather than blend into the ones that followed the rules.
    case "STATUS_OVERRIDE":
      return <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />;
    case "DELETE":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "UPDATE":
      return <FileText className="h-3.5 w-3.5 text-orange-500" />;
    default:
      return <User className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

/**
 * Relative timestamp that survives hydration.
 *
 * This markup is server-rendered and then hydrated, and "3 minutes ago" is
 * computed from `Date.now()` — two different instants — so React would warn
 * about a text mismatch on any row more than a few seconds old. `dateTime`
 * carries the exact instant for assistive tech and for anyone reading the DOM.
 */
function RelativeTime({
  iso,
  render,
}: {
  iso: string;
  render: (iso: string) => string;
}) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {render(iso)}
    </time>
  );
}

/**
 * The merged order timeline: system events and staff comments in one
 * chronological stream, newest first.
 *
 * They share a stream because the operator's question is mixed — "what
 * happened, and what did we do about it?". A refund line only means something
 * next to the comment under it explaining why. What separates the two is
 * VISUAL WEIGHT, not tabs: comments are full-width cards with an avatar,
 * events are single low-contrast lines. That is enough; a filter UI is not
 * earned until an order routinely has more rows than fit on screen.
 */
export function OrderTimelineFeed({
  orderId,
  entries,
  canComment = false,
  canModerate = false,
  currentUserId,
}: OrderTimelineFeedProps) {
  const t = useTranslations("admin");
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Close the editor only once the refreshed rows actually arrive. Clearing it
  // straight after the PATCH resolved flashed the PRE-edit body back at the
  // author for however long `router.refresh()` took to land.
  //
  // Adjusted during render rather than in an effect (React's documented
  // "changing state when props change" pattern) so there is no extra commit
  // and no flash of the stale editor.
  const [renderedEntries, setRenderedEntries] = useState(entries);
  if (renderedEntries !== entries) {
    setRenderedEntries(entries);
    setEditingId(null);
    setBusyId(null);
  }

  const relative = (iso: string) =>
    formatDistanceToNow(new Date(iso), { addSuffix: true });

  // Mirror the API exactly, so no action is offered that can only 403.
  // Editing needs EDIT_ORDERS *and* authorship; deleting your own needs either
  // permission; deleting someone else's needs DELETE_ORDERS/MANAGE_ORDERS.
  const isAuthor = (entry: OrderTimelineEntry) =>
    Boolean(currentUserId) && entry.authorId === currentUserId;
  const canEditEntry = (entry: OrderTimelineEntry) =>
    canComment && isAuthor(entry);
  const canDeleteEntry = (entry: OrderTimelineEntry) =>
    isAuthor(entry) ? canComment || canModerate : canModerate;

  const handlePost = async () => {
    const body = draft.trim();
    if (!body) return;

    setIsPosting(true);
    try {
      await apiClient.post(`/api/admin/orders/${orderId}/comments`, { body });
      setDraft("");
      toast.success(t("orderDetails.commentPosted"));
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("orderDetails.commentFailed"),
      );
    } finally {
      setIsPosting(false);
    }
  };

  const handleSaveEdit = async (commentId: string) => {
    const body = editDraft.trim();
    if (!body) return;

    setBusyId(commentId);
    try {
      await apiClient.patch(
        `/api/admin/orders/${orderId}/comments/${commentId}`,
        { body },
      );
      toast.success(t("orderDetails.commentUpdated"));
      // `editingId`/`busyId` clear when the refreshed rows arrive (see the
      // render-time reset above), so the editor keeps showing the new text
      // meanwhile rather than flashing the old body back.
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("orderDetails.commentFailed"),
      );
      setBusyId(null);
    }
  };

  const handleDelete = async (commentId: string) => {
    const confirmed = await confirm({
      type: "danger",
      title: t("orderDetails.commentDeleteTitle"),
      description: t("orderDetails.commentDeleteDescription"),
      confirmText: t("orderDetails.commentDelete"),
      cancelText: t("orderDetails.cancel"),
    });
    if (!confirmed) return;

    setBusyId(commentId);
    try {
      await apiClient.delete(
        `/api/admin/orders/${orderId}/comments/${commentId}`,
      );
      toast.success(t("orderDetails.commentDeleted"));
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("orderDetails.commentFailed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {canComment ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("orderDetails.addMessagePlaceholder")}
            className="min-h-20 resize-y"
            maxLength={2000}
            disabled={isPosting}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("orderDetails.commentVisibility")}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => void handlePost()}
              disabled={isPosting || draft.trim().length === 0}
            >
              {isPosting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("orderDetails.post")}
            </Button>
          </div>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground">
          {t("orderDetails.noEventsYet")}
        </p>
      ) : (
        // `role="list"` because the Tailwind preflight strips `list-style`,
        // which drops list semantics in Safari/VoiceOver. Logical properties
        // (border-s / ps / -inset-s-*) keep the rail on the correct side in
        // the Arabic admin.
        <ol
          role="list"
          className="relative space-y-4 border-s border-border ps-6"
        >
          {entries.map((entry) =>
            entry.kind === "comment" ? (
              <li key={entry._id} className="relative">
                <Avatar className="absolute -inset-s-9.5 top-0 h-7 w-7 ring-2 ring-background">
                  <AvatarImage src={entry.authorImage} alt="" />
                  <AvatarFallback className="text-xs" aria-hidden="true">
                    {entry.authorName?.charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>

                <div className="rounded-md border border-border bg-card p-3 shadow-sm">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">
                        {entry.authorName}
                      </span>
                      <span className="ms-2 text-xs text-muted-foreground">
                        <RelativeTime iso={entry.createdAt} render={relative} />
                        {entry.editedAt
                          ? ` · ${t("orderDetails.commentEdited")}`
                          : ""}
                      </span>
                    </div>

                    {canEditEntry(entry) || canDeleteEntry(entry) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            disabled={busyId === entry._id}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                            <span className="sr-only">
                              {t("orderDetails.moreActions")}
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* Editing is author-only by design: rewriting
                              someone else's words in a shared record is
                              falsification, not moderation. */}
                          {canEditEntry(entry) ? (
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingId(entry._id);
                                setEditDraft(entry.body || "");
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                              {t("orderDetails.commentEdit")}
                            </DropdownMenuItem>
                          ) : null}
                          {canDeleteEntry(entry) ? (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => void handleDelete(entry._id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("orderDetails.commentDelete")}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>

                  {editingId === entry._id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        // Radix returns focus to the (now closed) dropdown
                        // trigger, so without this a keyboard user has no idea
                        // the row became editable.
                        autoFocus
                        aria-label={t("orderDetails.commentEditLabel")}
                        className="min-h-20 resize-y"
                        maxLength={2000}
                        disabled={busyId === entry._id}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                          disabled={busyId === entry._id}
                        >
                          {t("orderDetails.cancel")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleSaveEdit(entry._id)}
                          disabled={
                            busyId === entry._id ||
                            editDraft.trim().length === 0
                          }
                        >
                          {busyId === entry._id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {t("orderDetails.commentSave")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // `wrap-break-word` so a pasted tracking URL wraps instead of
                    // widening the card and blowing out the admin grid.
                    <p className="whitespace-pre-wrap wrap-break-word text-sm">
                      {entry.body}
                    </p>
                  )}
                </div>
              </li>
            ) : (
              <li key={entry._id} className="relative">
                <span className="absolute -inset-s-8.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
                  {getIcon(entry.action, entry.status)}
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5">
                  <span className="text-sm">
                    {entry.summary || entry.action}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {/* One message, not "by" + actor concatenated — the word
                        order inverts in Turkish and Japanese. */}
                    {t("orderDetails.byActor", {
                      actor: entry.userEmail || t("orderDetails.system"),
                    })}{" "}
                    · <RelativeTime iso={entry.createdAt} render={relative} />
                  </span>
                </div>
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}
