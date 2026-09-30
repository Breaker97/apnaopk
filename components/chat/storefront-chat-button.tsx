"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * The guest's sign-in prompt. Only a guest who presses the button ever sees
 * it, so it is fetched when their pointer or focus reaches the button and
 * mounted on the first press — the pages the button sits on do not carry the
 * dialog. Client-only, so it waits for its chunk in a boundary of its own.
 */
const StorefrontChatSignInDialog = dynamic(
  () =>
    import("./storefront-chat-sign-in-dialog").then(
      (module) => module.StorefrontChatSignInDialog,
    ),
  { ssr: false },
);
const preloadSignInDialog = () => {
  // A failed download is retried by the `dynamic()` when it renders.
  void import("./storefront-chat-sign-in-dialog").catch(() => undefined);
};

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
  // By its full key: storefront pages carry a few `chat` strings, not the
  // namespace (lib/i18n/surface-messages.ts).
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const resolvedLabel = label || tf("chat.chatWithVendor", "Chat with vendor");
  const [signInPromptOpen, setSignInPromptOpen] = useState(false);
  const [signInPromptUsed, setSignInPromptUsed] = useState(false);
  const isGuest = !isLoading && !user;

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
    if (isGuest) {
      setSignInPromptUsed(true);
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
        onPointerEnter={isGuest ? preloadSignInDialog : undefined}
        onFocus={isGuest ? preloadSignInDialog : undefined}
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

      {signInPromptUsed ? (
        <StorefrontChatSignInDialog
          open={signInPromptOpen}
          onOpenChange={setSignInPromptOpen}
          locale={locale}
          inboxUrl={inboxUrl}
          context={product ? `${vendorName} · ${product.name}` : vendorName}
        />
      ) : null}
    </>
  );
}
