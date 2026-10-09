"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CountrySelect } from "@/components/common/country-multi-select";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
  SettingUnit,
} from "@/components/admin/settings/fields/setting-row";
import type { Settings } from "@/components/admin/settings/types";
import { EditDialogFooter, EditDialogHeader, useDraft } from "./dialog-fields";
import { countryLabel } from "./rate-summary";

type Origin = NonNullable<Settings["shipping"]["origin"]>;

/**
 * Settings → Shipping & Delivery → Dispatch: where parcels leave from and how
 * long the store takes to send them. The ship-from address is a line with an
 * Edit button: it changes about once a year, and six open inputs made it the
 * biggest thing on the page.
 */
export function DispatchCard(props: {
  settings: Settings;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping");
  const shipping = props.settings.shipping;
  const origin: Origin = shipping.origin || { country: "" };
  const delivery = shipping.delivery || {
    processingDaysMin: 0,
    processingDaysMax: 0,
    showEstimatedDelivery: true,
  };
  const [editingOrigin, setEditingOrigin] = useState(false);

  const address = [
    origin.address1,
    origin.address2,
    origin.city,
    [origin.state, origin.postalCode].filter(Boolean).join(" "),
    origin.country ? countryLabel(origin.country) : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dispatch.title")}</CardTitle>
        <CardDescription>{t("dispatch.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingList>
          <SettingRow label={t("origin.title")} hint={address || t("origin.empty")}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingOrigin(true)}
            >
              {t("origin.edit")}
            </Button>
          </SettingRow>

          <SettingRow
            inputId="processingDaysMin"
            label={t("delivery.processing")}
            hint={t("delivery.processingHint")}
          >
            <NumberInput
              id="processingDaysMin"
              className="w-20"
              min={0}
              step={1}
              normalize={Math.trunc}
              value={delivery.processingDaysMin ?? 0}
              whenEmpty={0}
              onValueChange={(next) =>
                props.updateField("shipping.delivery.processingDaysMin", next ?? 0)
              }
            />
            <SettingUnit>{t("units.to")}</SettingUnit>
            <NumberInput
              className="w-20"
              aria-label={t("delivery.processingMax")}
              min={0}
              step={1}
              normalize={Math.trunc}
              value={delivery.processingDaysMax ?? 0}
              whenEmpty={0}
              onValueChange={(next) =>
                props.updateField("shipping.delivery.processingDaysMax", next ?? 0)
              }
            />
            <SettingUnit>{t("units.days")}</SettingUnit>
          </SettingRow>

          <SettingSwitchItem
            title={t("delivery.showEstimated")}
            description={t("delivery.showEstimatedHint")}
            checked={delivery.showEstimatedDelivery ?? true}
            onCheckedChange={(checked) =>
              props.updateField("shipping.delivery.showEstimatedDelivery", checked)
            }
          />

          <SettingRow
            inputId="shippingWeightUnit"
            label={t("weightUnit.label")}
            hint={t("weightUnit.help")}
          >
            <Select
              value={shipping.weightUnit || "kg"}
              onValueChange={(value) => props.updateField("shipping.weightUnit", value)}
            >
              <SelectTrigger id="shippingWeightUnit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">{t("weightUnit.kg")}</SelectItem>
                <SelectItem value="lb">{t("weightUnit.lb")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingList>
      </CardContent>

      {editingOrigin ? (
        <OriginDialog
          initial={origin}
          onClose={() => setEditingOrigin(false)}
          onDone={(next) => {
            props.updateField("shipping.origin", next);
            setEditingOrigin(false);
          }}
        />
      ) : null}
    </Card>
  );
}

/** The ship-from address, edited on a copy. */
function OriginDialog(props: {
  initial: Origin;
  onClose: () => void;
  onDone: (origin: Origin) => void;
}) {
  const t = useTranslations("admin.settings.shipping");
  const { draft, set, changed } = useDraft<Origin>(props.initial);

  const field = (
    id: string,
    key: Exclude<keyof Origin, "country">,
    label: string,
    placeholder: string,
    wide = false,
  ) => (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={draft[key] ?? ""}
        placeholder={placeholder}
        onChange={(event) => set({ [key]: event.target.value })}
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : props.onClose())}>
      <DialogContent className="grid-cols-1 gap-0 p-0 sm:max-w-xl">
        <EditDialogHeader>
          <DialogTitle>{t("origin.title")}</DialogTitle>
          <DialogDescription>{t("origin.description")}</DialogDescription>
        </EditDialogHeader>
        <div className="grid max-h-[70vh] min-w-0 grid-cols-1 gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="shippingOriginCountry" className="text-sm font-medium">
              {t("origin.country")}
            </label>
            <CountrySelect
              id="shippingOriginCountry"
              modal
              value={draft.country || ""}
              onChange={(country) => set({ country })}
              // Where parcels leave from, which is not the same question as
              // where the store delivers: a warehouse or dropshipper can sit
              // outside every country on offer. The zone lists are the
              // ship-to side and stay restricted.
              restrictToAvailableCountries={false}
            />
          </div>
          {field("shippingOriginState", "state", t("origin.state"), t("origin.statePlaceholder"))}
          {field("shippingOriginCity", "city", t("origin.city"), t("origin.cityPlaceholder"))}
          {field(
            "shippingOriginPostalCode",
            "postalCode",
            t("origin.postalCode"),
            t("origin.postalCodePlaceholder"),
          )}
          {field(
            "shippingOriginAddress1",
            "address1",
            t("origin.address1"),
            t("origin.address1Placeholder"),
            true,
          )}
          {field(
            "shippingOriginAddress2",
            "address2",
            t("origin.address2"),
            t("origin.address2Placeholder"),
            true,
          )}
        </div>
        <EditDialogFooter
          onCancel={props.onClose}
          onDone={() => (changed ? props.onDone(draft) : props.onClose())}
        />
      </DialogContent>
    </Dialog>
  );
}
