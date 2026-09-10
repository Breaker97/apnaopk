"use client";

import { useState } from "react";
import { Reply, Star, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import type { AIAuthoringRequest } from "@/lib/ai-authoring/types";
import type { AdminReview } from "@/lib/admin/reviews-types";

interface ReviewReplyDialogProps {
  open: boolean;
  review: AdminReview | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const MAX_LENGTH = 1000;

export function ReviewReplyDialog({
  open,
  review,
  onOpenChange,
  onSaved,
}: ReviewReplyDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const aiAuthoring = useAiAuthoring({
    contentEndpoint: "/api/admin/ai-authoring/content",
  });
  const [lastSeenReviewId, setLastSeenReviewId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Reset draft text whenever the dialog opens for a different review.
  if (open && review && review._id !== lastSeenReviewId) {
    setLastSeenReviewId(review._id);
    setComment(review.reply?.comment || "");
  } else if (!open && lastSeenReviewId !== null) {
    setLastSeenReviewId(null);
  }

  const hasExisting = Boolean(review?.reply?.comment);
  const trimmed = comment.trim();
  const tooLong = trimmed.length > MAX_LENGTH;
  const canSave = trimmed.length > 0 && !tooLong;

  // Give the AI the full review so the reply is grounded in what the customer
  // actually wrote — rating, headline, body, and the product they reviewed.
  const productName =
    review && typeof review.productId === "object"
      ? review.productId.name
      : undefined;
  const replyRequest: AIAuthoringRequest = {
    entity: "review_reply",
    operation: "reply",
    locale,
    targetField: "comment",
    entityId: review?._id,
    fields: {
      rating: review?.rating,
      reviewTitle: review?.title,
      reviewComment: review?.comment,
      ...(productName ? { productName } : {}),
    },
    constraints: {
      maxLength: MAX_LENGTH,
      audience: "customer",
      tone: "supportive",
    },
  };

  const generateReplyDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("review-reply", request);
    if (typeof draft?.fields.comment === "string") return draft.fields.comment;
    if (typeof draft?.fields.reply === "string") return draft.fields.reply;
    return null;
  };

  const handleSave = async () => {
    if (!review || !canSave) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/reviews/${review._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: trimmed }),
      });
      if (!res.ok) {
        toast.error(t("common.error"));
        return;
      }
      toast.success(
        hasExisting
          ? t("admin.reviewsPage.toast.replyUpdated")
          : t("admin.reviewsPage.toast.replySent"),
      );
      onSaved();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!review || !hasExisting) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/admin/reviews/${review._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: null }),
      });
      if (!res.ok) {
        toast.error(t("common.error"));
        return;
      }
      toast.success(
        t("admin.reviewsPage.toast.replyRemoved"),
      );
      onSaved();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {hasExisting
              ? t("admin.reviewsPage.editReply")
              : t("admin.reviewsPage.replyToReview")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.reviewsPage.replyHint")}
          </DialogDescription>
        </DialogHeader>

        {review && (
          <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, idx) => (
                <Star
                  key={idx}
                  className={cn(
                    "h-3.5 w-3.5",
                    idx < review.rating
                      ? "fill-yellow-500 text-yellow-500"
                      : "fill-muted text-muted dark:fill-muted-foreground/30 dark:text-muted-foreground/30",
                  )}
                />
              ))}
            </div>
            {review.title && (
              <p className="text-sm font-semibold text-foreground">
                {review.title}
              </p>
            )}
            <p className="text-sm text-foreground/85 whitespace-pre-wrap">
              {review.comment}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="reply-comment"
              className="flex items-center gap-2 text-sm font-medium text-foreground"
            >
              <Reply className="h-4 w-4 -scale-x-100" />
              {t("admin.reviewsPage.yourReply")}
            </label>
            {review && (
              <AiGenerateMenu
                label={t("admin.reviewsPage.yourReply")}
                placeholder={t("admin.reviewsPage.aiReplyPlaceholder")}
                minChars={1}
                maxChars={MAX_LENGTH}
                allowAttachment={false}
                request={replyRequest}
                loading={aiAuthoring.isLoading("review-reply")}
                onGenerate={generateReplyDraft}
                onApply={(value) => setComment(value)}
              />
            )}
          </div>
          <Textarea
            id="reply-comment"
            rows={5}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("admin.reviewsPage.replyPlaceholder")}
            disabled={isSaving || isRemoving}
            maxLength={MAX_LENGTH + 1}
          />
          <div
            className={cn(
              "flex justify-end text-xs",
              tooLong ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {trimmed.length}/{MAX_LENGTH}
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-between sm:justify-between">
          <div>
            {hasExisting && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={handleRemove}
                disabled={isSaving || isRemoving}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {t("admin.reviewsPage.removeReply")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving || isRemoving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave || isSaving || isRemoving}
            >
              {hasExisting
                ? t("common.save")
                : t("admin.reviewsPage.sendReply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
