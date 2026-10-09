"use client";

import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * What a guest who asks to chat is told: the conversation lives in their
 * account inbox, so they sign in first and come back to `inboxUrl`.
 *
 * Its own module so the dialog stays out of the pages the chat button sits
 * on (the product and vendor pages) until a guest actually presses it.
 */
export function StorefrontChatSignInDialog({
  open,
  onOpenChange,
  locale,
  inboxUrl,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  inboxUrl: string;
  /** "Store · Product", shown so the shopper knows which chat waits. */
  context: string;
}) {
  const router = useRouter();
  // By its full key: storefront pages carry a few `chat` strings, not the
  // namespace (lib/i18n/surface-messages.ts).
  const tf = useFallbackTranslator(useTranslations());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tf("chat.signInToChatTitle", "Sign in to start chatting")}
          </DialogTitle>
          <DialogDescription>
            {tf(
              "chat.signInToChatDescription",
              "Your conversation with the store is kept in your account inbox, so you can pick it up any time and never lose a reply.",
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {context}
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {tf("chat.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => router.push(buildLoginUrl(locale, inboxUrl))}
          >
            {tf("chat.signIn", "Sign in")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
