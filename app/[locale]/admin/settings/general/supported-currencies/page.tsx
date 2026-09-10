"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { SubPageShell } from "@/components/admin/settings/drill/sub-page-shell";
import { currencyOptionsFor } from "@/components/admin/settings/general/constants";
import { AddCurrencyField } from "@/components/admin/settings/general/add-currency-field";

export default function Page() {
  const { locale } = useParams<{ locale: string }>();
  const { refreshSettings } = useMultiVendorMode();
  const {
    isSaving,
    dirtySections,
    updateNestedField,
    saveSection,
  } = useAdminSettingsContext();
  // Keeps a just-added (or just-unchecked) custom code on screen until save.
  const [addedCurrencies, setAddedCurrencies] = useState<string[]>([]);

  return (
    <SectionLoader>
      {(loadedSettings) => {
        const g = loadedSettings.general;
        const defaultCurrency = g.defaultCurrency || "USD";
        const supported = Array.from(
          new Set([
            ...(g.supportedCurrencies?.length
              ? g.supportedCurrencies
              : ["USD"]),
            defaultCurrency,
          ]),
        );
        const options = currencyOptionsFor([...supported, ...addedCurrencies]);

        const toggle = (code: string, checked: boolean) => {
          const next = checked
            ? Array.from(new Set([...supported, code]))
            : supported.filter((v) => v !== code);
          if (next.length === 0) return;
          updateNestedField("general.supportedCurrencies", next);
          if (!next.includes(defaultCurrency)) {
            updateNestedField("general.defaultCurrency", next[0]);
          }
        };

        const addCurrency = (code: string) => {
          setAddedCurrencies((prev) =>
            prev.includes(code) ? prev : [...prev, code],
          );
          updateNestedField("general.supportedCurrencies", [
            ...supported,
            code,
          ]);
        };

        return (
          <SubPageShell
            backHref={`/${locale}/admin/settings/general`}
            title="Supported currencies"
            description="Currencies customers can pay in"
            isSaving={isSaving}
            isDirty={dirtySections.has("general")}
            onSave={async () => {
              const ok = await saveSection("general", g);
              if (ok) await refreshSettings();
            }}
          >
            <div className="space-y-3">
              <div className="rounded-xl bg-card p-2 ring-1 ring-border/70">
                <ul className="divide-y divide-border/60">
                  {options.map((c) => {
                    const isDefault = c.code === defaultCurrency;
                    const isChecked = supported.includes(c.code);
                    return (
                      <li key={c.code}>
                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(v) =>
                                toggle(c.code, Boolean(v))
                              }
                            />
                            <span className="min-w-0 text-sm">
                              <span className="font-medium">{c.code}</span>
                              {c.name ? (
                                <span className="ml-2 text-muted-foreground">
                                  {c.name}
                                </span>
                              ) : null}
                            </span>
                          </label>
                          {isDefault ? (
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[10px] px-1.5 py-0"
                            >
                              Default
                            </Badge>
                          ) : isChecked ? (
                            <button
                              type="button"
                              onClick={() =>
                                updateNestedField(
                                  "general.defaultCurrency",
                                  c.code,
                                )
                              }
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              Set default
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <AddCurrencyField existing={supported} onAdd={addCurrency} />
            </div>
          </SubPageShell>
        );
      }}
    </SectionLoader>
  );
}
