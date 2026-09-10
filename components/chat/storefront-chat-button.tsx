"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface StorefrontChatButtonProps {
  locale: string;
  vendorId?: string;
  vendorName: string;
  /**
   * Omitted on the vendor storefront, where the thread is about the store
   * itself rather than one product.
   */
  product?: {
    id: string;
    name: string;
    variantId?: string;
    variantName?: string;
  };
  label?: string;
  className?: string;
  /** Icon-only trigger, to sit beside the storefront's other channel buttons. */
  compact?: boolean;
  /**
   * Button styling. `ghost` where chat is a secondary control — the storefront
   * header, where Follow is the one filled button — `outline` everywhere else.
   */
  variant?: "outline" | "ghost";
}

/**
 * Storefront entry point into the customer inbox.
 *
 * Chat is sign-in gated: a guest gets an explaining dialog and is handed to the
 * login page with a `redirect` back to the very inbox URL they were heading
 * for, so the product or store context survives the round trip. A signed-in
 * shopper goes straight there. Either way the conversation lives in one place
 * instead of a popup the shopper has to reopen.
 */
export function StorefrontChatButton({
  locale,
  vendorId,
  vendorName,
  product,
  label,
  className,
  compact = false,
  variant = "outline",
}: StorefrontChatButtonProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);
  const resolvedLabel = label || tr("chatWithVendor", "Chat with vendor");
  const [signInPromptOpen, setSignInPromptOpen] = useState(false);

  // The inbox lives in the customer-only account area; staff-side roles
  // (admin/vendor/staff) would only bounce off its guard, so they get no
  // chat button at all. While the session is still resolving the button
  // renders and works (see openChat below) — a staff session popping it out
  // on a hard load is the accepted cost of keeping it live for everyone
  // else during that window.
  if (getRoleDashboardPath(locale, user?.role)) {
    return null;
  }

  const inboxUrl = (() => {
    const params = new URLSearchParams();
    if (product) params.set("product", product.id);
    if (vendorId) params.set("vendor", vendorId);
    if (product?.variantId) params.set("variant", product.variantId);
    if (product?.variantName) params.set("variantName", product.variantName);
    const query = params.toString();
    return `/${locale}/account/inbox${query ? `?${query}` : ""}`;
  })();

  const openChat = () => {
    // Only a *known* guest gets the prompt. While the session is still
    // resolving we navigate anyway: the inbox is a server component and
    // redirects to login with this same URL as `redirect`, so an unresolved
    // session degrades into the identical flow instead of a dead button.
    if (!isLoading && !user) {
      setSignInPromptOpen(true);
      return;
    }
    router.push(inboxUrl);
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={compact ? "icon" : "sm"}
        onClick={openChat}
        aria-label={compact ? resolvedLabel : undefined}
        className={cn(
          compact ? "size-9 rounded-full" : "h-9 rounded-sm",
          variant === "ghost" && "text-muted-foreground",
          className,
        )}
      >
        <MessageCircle className="size-4" />
        {compact ? null : resolvedLabel}
      </Button>

      <Dialog open={signInPromptOpen} onOpenChange={setSignInPromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tr("signInToChatTitle", "Sign in to start chatting")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "signInToChatDescription",
                "Your conversation with the store is kept in your account inbox, so you can pick it up any time and never lose a reply.",
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {product ? `${vendorName} · ${product.name}` : vendorName}
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSignInPromptOpen(false)}
            >
              {tr("cancel", "Cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => router.push(buildLoginUrl(locale, inboxUrl))}
            >
              {tr("signIn", "Sign in")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
