"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import Link from "@/components/language/link";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";

/**
 * The head of Settings → Multi-Vendor Mode, holding the switch itself.
 *
 * It used to be a header box and, under it, a card repeating the same title
 * and description beside the switch. Turning the marketplace on asks nothing,
 * the save bar confirms it; turning it off first says what changes, because
 * vendor products keep selling while their sales stop being the vendor's
 * (lib/orders/order-vendors.ts sends every line to the house store).
 */
export function MarketplaceSettingsTab(props: {
  settings: Settings;
  /** Whether it is on in the saved copy: the vendor pages exist only then. */
  savedEnabled: boolean;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.security.multiVendor");
  const tCommon = useTranslations("common");
  const [confirmOff, setConfirmOff] = useState(false);
  const enabled = props.settings.multiVendorMode.enabled;

  const linkClass =
    "text-primary inline-flex items-center gap-1.5 hover:underline";

  return (
    <>
      <SettingsTabHeader
        title={t("label")}
        description={t("description")}
        control={
          <Switch
            className="mt-1"
            checked={enabled}
            aria-label={t("label")}
            onCheckedChange={(on) => {
              if (on) props.updateField("multiVendorMode.enabled", true);
              else setConfirmOff(true);
            }}
          />
        }
      >
        {enabled && props.savedEnabled ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            <Link href="/admin/vendors/configuration" className={linkClass}>
              {t("registrationLink")}
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/admin/vendors" className={linkClass}>
              {t("vendorsLink")}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : null}
      </SettingsTabHeader>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        onConfirm={() => {
          props.updateField("multiVendorMode.enabled", false);
          setConfirmOff(false);
        }}
        type="warning"
        confirmVariant="destructive"
        title={t("turnOff.title")}
        description={t("turnOff.description")}
        confirmText={t("turnOff.confirm")}
        cancelText={tCommon("cancel")}
      >
        <ul className="list-disc space-y-1.5 ps-5 text-sm">
          <li>{t("turnOff.registration")}</li>
          <li>{t("turnOff.dashboards")}</li>
          <li>{t("turnOff.sales")}</li>
          <li>{t("turnOff.payouts")}</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}
