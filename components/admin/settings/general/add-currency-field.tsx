"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import {
  currencyDisplayName,
  isValidCurrencyCode,
  normalizeCurrencyCode,
} from "@/lib/intl/currency-codes";
import { useTranslations } from "next-intl";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Adds an arbitrary currency to the supported list.
 *
 * The bundled shortlist can never cover every market, so any well-formed ISO
 * 4217 code is accepted — Intl supplies the name and the decimal places, so a
 * custom code formats correctly everywhere prices are rendered.
 */
export function AddCurrencyField(props: {
  existing: string[];
  onAdd: (code: string) => void;
}) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);
  const [value, setValue] = useState("");

  const code = normalizeCurrencyCode(value);
  const previewName = isValidCurrencyCode(code) ? currencyDisplayName(code) : "";

  const submit = () => {
    if (!isValidCurrencyCode(code)) {
      toast.error(
        tSafe(
          "admin.settings.general.currencyCodeHint",
          "Enter a 3-letter currency code, like CHF.",
        ),
      );
      return;
    }
    if (props.existing.includes(code)) {
      toast.error(`${code} is already in the list.`);
      return;
    }
    props.onAdd(code);
    setValue("");
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            submit();
          }}
          placeholder="CHF"
          maxLength={3}
          autoComplete="off"
          spellCheck={false}
          aria-label="Custom currency code"
          className="w-24 uppercase tracking-wide"
        />
        <Button type="button" variant="outline" size="sm" onClick={submit}>
          <Plus className="h-4 w-4" />
          Add currency
        </Button>
        {previewName ? (
          <span className="text-xs text-muted-foreground">{previewName}</span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Any 3-letter ISO 4217 code works. Added currencies can be set as the
        store default like any other.
      </p>
    </div>
  );
}
