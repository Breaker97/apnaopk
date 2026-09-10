import { Eye, X } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";

/**
 * Floating indicator on the /draft preview routes, with the way out — a
 * plain link to the LIVE version of the same page. `data-draft-pill` lets
 * the builder's embedded preview hide it (the builder owns that session).
 */
export async function DraftPreviewPill({
  locale,
  livePath,
}: {
  locale: Locale;
  livePath: string;
}) {
  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <div
      data-draft-pill
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2"
    >
      <div className="flex items-center gap-3 rounded-full border border-border bg-foreground px-4 py-2 text-background shadow-lg">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <Eye className="h-3.5 w-3.5" aria-hidden />
          {t("previewingDraft")}
        </span>
        <Link
          href={livePath}
          className="flex items-center gap-1 rounded-full bg-background/20 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-background/30"
        >
          <X className="h-3 w-3" aria-hidden />
          {t("exitPreview")}
        </Link>
      </div>
    </div>
  );
}
