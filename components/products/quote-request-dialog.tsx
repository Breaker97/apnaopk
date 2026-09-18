"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { getSession } from "@/lib/auth/auth-client";

/**
 * "Request a quote" — the form behind the button a `priceOnRequest` product
 * shows in place of Add to cart.
 *
 * A lead-capture form, not a checkout: nothing here is priced, no stock is
 * held, and the shopper is not asked to sign in. Signing in is used to save
 * them typing — the fields are prefilled from the session when the dialog
 * opens (in the open handler, so a page full of quote products subscribes to
 * nothing until someone actually asks) — and to tell them where the answer
 * will turn up. A signed-out request still reaches the merchant, and reaches
 * its sender by email; it joins their account the first time they sign in with
 * that address.
 */

export type QuoteRequestTarget = {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  /** Where the buy box's quantity stepper stands when the dialog opens. */
  quantity?: number;
};

type QuoteFormState = {
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
  quantity: number;
  /** Honeypot — hidden from people, irresistible to bots. */
  website: string;
};

function emptyForm(quantity: number): QuoteFormState {
  return {
    name: "",
    email: "",
    phone: "",
    company: "",
    message: "",
    quantity: Math.max(1, Math.round(quantity) || 1),
    website: "",
  };
}

export function QuoteRequestDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: QuoteRequestTarget;
}) {
  const t = useTranslations();
  const [form, setForm] = useState<QuoteFormState>(() =>
    emptyForm(target.quantity ?? 1),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  /** Whether the sender has an account the answer will show up in. */
  const [hasAccount, setHasAccount] = useState(false);

  const set = <K extends keyof QuoteFormState>(
    key: K,
    value: QuoteFormState[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "";

  const handleOpenChange = useCallback(
    async (next: boolean) => {
      onOpenChange(next);
      if (!next) return;

      // Fresh form on every open, seeded with the buy box's current quantity,
      // so a second request is never a re-send of the first one's fields.
      setForm(emptyForm(target.quantity ?? 1));
      setIsSent(false);

      const session = await getSession().catch(() => null);
      const user = session?.data?.user;
      setHasAccount(Boolean(user));
      if (!user) return;
      setForm((current) => ({
        ...current,
        name: current.name || user.name || "",
        email: current.email || user.email || "",
      }));
    },
    [onOpenChange, target.quantity],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await apiClient.post("/api/quotes", {
        productId: target.productId,
        variantId: target.variantId,
        quantity: form.quantity,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        company: form.company.trim(),
        message: form.message.trim(),
        website: form.website,
      });
      setIsSent(true);
      toast.success(t("product.quoteRequestSent"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("common.error"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const productLabel = target.variantName
    ? `${target.productName} — ${target.variantName}`
    : target.productName;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("product.requestQuote")}</DialogTitle>
          <DialogDescription>
            {isSent
              ? t("product.quoteRequestSentHelp")
              : t("product.quoteRequestHelp", { product: productLabel })}
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <DialogFooter className="gap-2">
            {hasAccount ? (
              <Button asChild variant="outline">
                <Link href={`/${locale}/account/quotes`}>
                  {t("product.quoteTrackInAccount")}
                </Link>
              </Button>
            ) : null}
            <Button type="button" onClick={() => handleOpenChange(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="quote-name">{t("common.name")}</Label>
                <Input
                  id="quote-name"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-email">{t("common.email")}</Label>
                <Input
                  id="quote-email"
                  type="email"
                  required
                  maxLength={160}
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-phone">
                  {t("product.quotePhoneOptional")}
                </Label>
                <Input
                  id="quote-phone"
                  type="tel"
                  maxLength={40}
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-company">
                  {t("product.quoteCompanyOptional")}
                </Label>
                <Input
                  id="quote-company"
                  maxLength={100}
                  autoComplete="organization"
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5 sm:max-w-[10rem]">
              <Label htmlFor="quote-quantity">{t("common.quantity")}</Label>
              <NumberInput
                id="quote-quantity"
                min={1}
                step="1"
                value={form.quantity}
                whenEmpty={1}
                normalize={(value) => Math.max(1, Math.round(value))}
                onValueChange={(value) => set("quantity", value ?? 1)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quote-message">
                {t("product.quoteMessageOptional")}
              </Label>
              <Textarea
                id="quote-message"
                rows={4}
                maxLength={2000}
                placeholder={t("product.quoteMessagePlaceholder")}
                value={form.message}
                onChange={(e) => set("message", e.target.value)}
              />
            </div>

            {/* Honeypot. Hidden from people and from assistive tech; a bot that
                fills every field it can find identifies itself here. */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="quote-website">Website</label>
              <input
                id="quote-website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("product.sendQuoteRequest")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
