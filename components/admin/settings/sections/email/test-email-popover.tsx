"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Send test email", with the address in a small popover: the signed-in
 * admin's own until they type another. It used to be a field of its own under
 * the form, empty every visit.
 */
export function TestEmailPopover({
  defaultTo,
  disabled,
  busy,
  onSend,
}: {
  /** The signed-in admin's address; it may arrive after the first render. */
  defaultTo: string;
  disabled: boolean;
  busy: boolean;
  onSend: (to: string) => Promise<unknown>;
}) {
  const t = useTranslations("admin.settings.email.test");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  // Null until the admin types, so a session that loads late still fills it.
  const [typed, setTyped] = useState<string | null>(null);
  const to = (typed ?? defaultTo).trim();
  const valid = EMAIL_PATTERN.test(to);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    await onSend(to);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Send className="mr-2 h-4 w-4" />
          {t("button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <Label htmlFor="test-email-to">{t("label")}</Label>
          <Input
            id="test-email-to"
            type="email"
            autoComplete="email"
            value={typed ?? defaultTo}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="you@example.com"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!valid || busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? t("sending") : t("send")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
