"use client";

/**
 * One colour on an element: the admin's `ColorSwatchPicker`, never the
 * browser's own colour input. A value of `transparent` shows as an empty
 * swatch; with `allowNone` a button puts "no fill" back. The schema keeps
 * element colours to `#rrggbb` (or `transparent`), so the picker offers no
 * opacity.
 */
import { useTranslations } from "next-intl";
import { ColorSwatchPicker } from "@/components/admin/color-swatch-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FALLBACK_SWATCH = "#ffffff";

export function ColourField({
  value,
  onChange,
  label,
  allowNone,
  noneValue = "transparent",
  field,
  disabled,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
  allowNone?: boolean;
  /** What "No fill" writes: `transparent`, or "" where the schema's optional colour means none. */
  noneValue?: string;
  field?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.colours");
  const none = !value || value === "transparent";
  return (
    <div className="flex items-center gap-2" data-colour-field={field}>
      <ColorSwatchPicker
        value={none ? FALLBACK_SWATCH : value}
        onChange={onChange}
        ariaLabel={label}
        alpha={false}
        disabled={disabled}
        className={cn("h-8", allowNone ? "w-14" : "w-full", none && allowNone && "opacity-60")}
      />
      {allowNone && (
        <Button
          type="button"
          variant={none ? "secondary" : "outline"}
          size="sm"
          className="h-8 shrink-0 px-2 text-xs"
          aria-pressed={none}
          disabled={disabled}
          data-action={`${field ?? "colour"}-none`}
          onClick={() => onChange(noneValue)}
        >
          {t("noFill")}
        </Button>
      )}
    </div>
  );
}
