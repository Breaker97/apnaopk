"use client";

/**
 * "New template": straight to a blank canvas in the open tab (owner,
 * 2026-10-14) — a preset is started from its own card. It links to the
 * unsaved draft (the scope's `…/invoice-templates/new`), so nothing is
 * created until the draft's first Save — which also makes it work in demo
 * mode, where the editor opens but cannot save.
 */
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import type { TemplateCategory, TemplateLocale } from "@/lib/invoice-templates/types";
import { useTemplateScope } from "../template-scope";

export function useDraftLanguage(): TemplateLocale {
  return useLocale() === "bn" ? "bn" : "en";
}

export function NewTemplateButton({
  category,
  disabled,
  className,
}: {
  category: TemplateCategory;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("admin.invoiceTemplates.manager");
  const lang = useDraftLanguage();
  const templateHref = useTemplateScope().href;

  if (disabled) {
    return (
      <Button disabled className={className}>
        <Plus aria-hidden />
        {t("actions.new")}
      </Button>
    );
  }
  return (
    <Button asChild className={className}>
      <Link href={templateHref.create(category, { lang })}>
        <Plus aria-hidden />
        {t("actions.new")}
      </Link>
    </Button>
  );
}
