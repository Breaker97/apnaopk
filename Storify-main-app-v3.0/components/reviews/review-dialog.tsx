"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppImage } from "@/components/ui/app-image";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { ReviewForm } from "./review-form";

/** One product on one order — what a review is written against. */
export interface ReviewTarget {
  productId: string;
  orderId: string;
  name: string;
  image?: string | null;
  orderNumber?: string;
  /** Preselected, when the shopper opened the form by tapping a star. */
  rating?: number;
}

interface ReviewDialogProps {
  /** The product being reviewed; null closes the dialog. */
  target: ReviewTarget | null;
  onClose: () => void;
  onReviewed: (target: ReviewTarget, rating: number) => void;
}

/**
 * The review form for a purchase the shopper was asked about, headed by the
 * product so they can see what they are rating. The account pages open it
 * from a known delivered order, so unlike the product page's dialog it has no
 * eligibility to look up first.
 */
export function ReviewDialog({ target, onClose, onReviewed }: ReviewDialogProps) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);

  // Keeps rendering the last product while the dialog animates closed, so the
  // body does not collapse to an empty header on its way out.
  const [shown, setShown] = useState(target);
  useApplyOnChange([target], () => {
    if (target) setShown(target);
  });

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tf("reviews.writeReview", "Write a Review")}</DialogTitle>
          <DialogDescription>
            {tf(
              "reviews.writeReviewHint",
              "Your email address will not be published. Required fields are marked with an asterisk (*).",
            )}
          </DialogDescription>
        </DialogHeader>

        {shown ? (
          <>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                {shown.image ? (
                  <AppImage
                    src={shown.image}
                    alt={shown.name}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium">{shown.name}</p>
                {shown.orderNumber ? (
                  <p className="text-xs text-muted-foreground">
                    {tf("reviews.fromOrder", "Order #{orderNumber}", {
                      orderNumber: shown.orderNumber,
                    })}
                  </p>
                ) : null}
              </div>
            </div>

            <ReviewForm
              // A fresh form per product and per star tapped, never the
              // previous product's half-written review.
              key={`${shown.orderId}:${shown.productId}:${shown.rating ?? 0}`}
              productId={shown.productId}
              orderId={shown.orderId}
              initialRating={shown.rating}
              onSuccess={(review) => onReviewed(shown, review.rating)}
              onCancel={onClose}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
