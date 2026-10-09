"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CountryMultiSelect } from "@/components/common/country-multi-select";
import { RegionMultiSelect } from "@/components/common/region-multi-select";
import { EditDialogFooter, EditDialogHeader, SwitchRow, useDraft } from "./dialog-fields";
import type { ShippingZone } from "./rate-summary";

/**
 * Add or edit a shipping zone: its name, where it applies, or that it is the
 * catch-all for every address no other zone covers ("Rest of the world").
 *
 * It edits a copy, like the rate dialog: Done hands it back, Cancel drops it.
 * The page keeps exactly one catch-all when a copy comes back with the flag.
 */
export function ZoneDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isNew?: boolean;
  initial: ShippingZone;
  onDone: (zone: ShippingZone) => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("admin.settings.shipping");
  const { draft, set, changed } = useDraft<ShippingZone>(props.initial);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* A title is all this dialog needs; say so, or Radix warns that a description is missing. */}
      <DialogContent aria-describedby={undefined} className="grid-cols-1 gap-0 p-0 sm:max-w-xl">
        <EditDialogHeader>
          <DialogTitle>
            {props.isNew ? t("zone.dialogTitleNew") : t("zone.edit")}
          </DialogTitle>
        </EditDialogHeader>

        <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <label htmlFor="zone-name" className="text-sm font-medium">
              {t("zone.name")}
            </label>
            <Input
              id="zone-name"
              value={draft.name ?? ""}
              placeholder={t("zone.namePlaceholder")}
              onChange={(event) => set({ name: event.target.value })}
            />
            <p className="text-muted-foreground text-xs">{t("zone.nameHint")}</p>
          </div>

          <SwitchRow
            title={t("zone.isFallback")}
            hint={t("zone.isFallbackHint")}
            checked={Boolean(draft.isFallback)}
            onCheckedChange={(checked) => set({ isFallback: checked })}
          />

          {/* A catch-all ignores its countries and regions, so they are not
              asked for; whatever was there is kept for if it is switched back. */}
          {draft.isFallback ? null : (
            <>
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="zone-countries" className="text-sm font-medium">
                  {t("zone.countries")}
                </label>
                <CountryMultiSelect
                  id="zone-countries"
                  modal
                  value={draft.countries || []}
                  onChange={(countries) => set({ countries })}
                  placeholder={t("zone.countriesPlaceholder")}
                  searchPlaceholder={t("zone.searchCountries")}
                  emptyText={t("zone.noCountryMatches")}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="zone-regions" className="text-sm font-medium">
                  {t("zone.regions")}
                </label>
                <RegionMultiSelect
                  id="zone-regions"
                  modal
                  countries={draft.countries || []}
                  value={draft.regions || []}
                  onChange={(regions) => set({ regions })}
                  placeholder={t("zone.regionsPlaceholder")}
                  searchPlaceholder={t("zone.searchRegions")}
                  emptyText={t("zone.noRegionMatches")}
                  freeTextPlaceholder={t("zone.regionsFreeTextPlaceholder")}
                />
                <p className="text-muted-foreground text-xs">{t("zone.regionsHint")}</p>
              </div>
            </>
          )}
        </div>

        <EditDialogFooter
          removeLabel={t("zone.delete")}
          onRemove={props.onDelete}
          onCancel={() => props.onOpenChange(false)}
          onDone={() =>
            changed || props.isNew ? props.onDone(draft) : props.onOpenChange(false)
          }
        />
      </DialogContent>
    </Dialog>
  );
}
