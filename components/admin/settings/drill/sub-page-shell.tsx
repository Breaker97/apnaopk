"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useUnsavedNavigation } from "./use-unsaved-navigation";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export function SubPageShell({
  backHref,
  title,
  description,
  isSaving,
  isDirty,
  onSave,
  saveLabel,
  children,
}: {
  backHref: string;
  title: string;
  description?: string;
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void | Promise<unknown>;
  saveLabel?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const navigate = useUnsavedNavigation();

  const tSafe = useFallbackTranslator(t);

  const handleBack = () => {
    void navigate(backHref, () => router.push(backHref));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleBack}
          className="-ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={tSafe("common.back", "Back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl font-semibold leading-tight">{title}</h1>
      </div>
      {description && (
        <p className="-mt-3 ml-8 text-sm text-muted-foreground">
          {description}
        </p>
      )}

      <div className="space-y-5">{children}</div>

      <div className="sticky bottom-0 -mx-4 mt-8 flex justify-end border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
        <Button onClick={() => onSave()} disabled={isSaving || !isDirty}>
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saveLabel ?? tSafe("admin.settings.general.save", "Save")}
        </Button>
      </div>
    </div>
  );
}
