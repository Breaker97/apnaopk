"use client";

import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The form is only drawn once the shopper may review. It starts loading when
// a signed-in shopper opens the dialog, alongside the eligibility check it
// waits on (reviews-list.tsx).
const ReviewForm = dynamic(() =>
  import("./review-form").then((module) => module.ReviewForm),
);

type Translate = (key: string, fallback: string) => string;

/**
 * The write-a-review dialog of the product page's review thread. Its own
 * module, loaded when the shopper reaches for "Write a review!": the thread
 * is on every product page, the dialog (and its dialog code) only for the few
 * who open it. The thread keeps the state; this draws it.
 */
export function WriteReviewDialog({
  open,
  onOpenChange,
  isAuthenticated,
  isCheckingEligibility,
  alreadyReviewed,
  eligibilityError,
  eligibleOrderId,
  productId,
  onLogin,
  onSuccess,
  tf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAuthenticated: boolean;
  isCheckingEligibility: boolean;
  alreadyReviewed: boolean;
  eligibilityError: string | null;
  eligibleOrderId: string | null;
  productId: string;
  onLogin: () => void;
  onSuccess: () => void;
  tf: Translate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tf("reviews.writeReview", "Write a review")}</DialogTitle>
          <DialogDescription>
            {tf(
              "reviews.writeReviewHint",
              "Your email address will not be published. Required fields are marked with an asterisk (*).",
            )}
          </DialogDescription>
        </DialogHeader>

        {!isAuthenticated ? (
          <div className="space-y-4 rounded-xl border border-border/70 p-4">
            <p className="text-sm text-muted-foreground">
              {tf(
                "reviews.loginToReview",
                "Please sign in to write a review for this product.",
              )}
            </p>
            <Button className="rounded-full" onClick={onLogin}>
              {tf("common.login", "Login")}
            </Button>
          </div>
        ) : isCheckingEligibility ? (
          <div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">
            {tf("reviews.checkingEligibility", "Checking your eligible orders...")}
          </div>
        ) : alreadyReviewed ? (
          <div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">
            {tf(
              "reviews.alreadyReviewed",
              "You have already reviewed this product. Thank you for sharing your experience!",
            )}
          </div>
        ) : eligibilityError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {eligibilityError}
          </div>
        ) : eligibleOrderId ? (
          <ReviewForm
            productId={productId}
            orderId={eligibleOrderId}
            onSuccess={onSuccess}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
