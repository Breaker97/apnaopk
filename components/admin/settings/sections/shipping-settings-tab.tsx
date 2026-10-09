"use client";

import { useTranslations } from "next-intl";
import type { Settings } from "@/components/admin/settings/types";
import type { CarrierProvider } from "@/lib/shipping/carrier-config";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { AddressHoldCard } from "./shipping/address-hold-card";
import { CarriersLabelsCard } from "./shipping/carriers-labels-card";
import { CustomsCard } from "./shipping/customs-card";
import { DispatchCard } from "./shipping/dispatch-card";
import { ShippingRatesCard } from "./shipping/shipping-rates-card";
import { VendorShippingCard } from "./shipping/vendor-shipping-card";

/**
 * Settings → Shipping & Delivery, in the order a parcel meets it: what
 * shipping costs and where (rates), where it leaves from and how fast
 * (dispatch), who carries it (carriers & labels), what changes with vendors
 * and borders, and what happens when the address turns out wrong.
 *
 * It used to be one card holding fourteen topics between separators, every
 * rate and carrier credential open as a form. Each topic is now a card that
 * says what is set, and the forms open in dialogs.
 */
export function ShippingSettingsTab(props: {
  /** The whole document — the carrier cards read `_meta` for credential state. */
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  isCarrierBusy: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
  onTestCarrier: (provider: CarrierProvider) => void | Promise<unknown>;
  onRegisterCarrierWebhook: (provider: CarrierProvider) => void | Promise<unknown>;
  onDisconnectCarrier: (provider: CarrierProvider) => void | Promise<unknown>;
  onLoadPickupLocations: () => Promise<string[]>;
}) {
  const t = useTranslations("admin.settings");
  const { settings, updateField } = props;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("shipping.title")}
        description={t("shipping.description")}
      />

      <ShippingRatesCard settings={settings} updateField={updateField} />
      <DispatchCard settings={settings} updateField={updateField} />
      <CarriersLabelsCard
        settings={settings}
        updateField={updateField}
        isBusy={props.isCarrierBusy}
        isDirty={props.isDirty}
        isSaving={props.isSaving}
        onSave={props.onSave}
        onTestConnection={props.onTestCarrier}
        onRegisterWebhook={props.onRegisterCarrierWebhook}
        onDisconnect={props.onDisconnectCarrier}
        onLoadPickupLocations={props.onLoadPickupLocations}
      />
      {settings.multiVendorMode?.enabled ? (
        <VendorShippingCard settings={settings} updateField={updateField} />
      ) : null}
      <CustomsCard settings={settings} updateField={updateField} />
      <AddressHoldCard
        addressHold={settings.shipping.addressHold}
        updateField={updateField}
      />

      <StickySaveFooter
        label={t("general.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      />
    </div>
  );
}
