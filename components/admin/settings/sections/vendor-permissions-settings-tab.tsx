"use client";

import { useTranslations } from "next-intl";
import { WarningBanner } from "@/components/ui/warning-banner";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  ALL_VENDOR_PACKS,
  LEGACY_POLICY_FLAG_OF_PACK,
  type VendorPermissionPack,
  type VendorPolicyFlags,
} from "@/config/permissions.config";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";

/** What each switch buys a vendor, for the operator setting marketplace policy. */
const PACK_BLURB_KEYS: Record<VendorPermissionPack, string> = {
  catalog: "packCatalog",
  orders: "packOrders",
  storefront: "packStorefront",
  analytics: "packAnalytics",
  inbox: "packInbox",
  staff: "packStaff",
  discounts: "packDiscounts",
  pos: "packPos",
  payouts: "packPayouts",
  boosts: "packBoosts",
  aiStudio: "packAiStudio",
};

/**
 * Settings → Marketplace policy.
 *
 * One switch per capability pack — the outermost of the four access layers, and
 * a platform-wide kill switch rather than a default for new vendors. Turning one
 * off takes the capability from every existing store on the next request.
 *
 * It used to be eight `multiVendorMode.can*` booleans covering eleven packs, so
 * "Manage Store Settings" silently carried Staff and the Inbox with it
 * (guideline P5). Now a switch reaches exactly as far as its label, which is why
 * this screen no longer has to explain a blast radius.
 *
 * A store that has not been migrated has no `packPolicy` yet;
 * `readVendorPolicyFlags` derives each pack from the boolean it used to sit
 * under, so the split changed nothing until someone moves a switch here.
 */
export function VendorPermissionsSettingsTab(props: {
  settings: Settings;
  updateField: (path: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("admin.settings.vendorPermissions");
  const tPacks = useTranslations("permissionPacks");
  const mv = props.settings.multiVendorMode as typeof props.settings.multiVendorMode &
    Partial<VendorPolicyFlags> & {
      packPolicy?: Partial<Record<VendorPermissionPack, boolean>>;
    };

  /** Same fallback the server applies, so the screen shows the live answer. */
  const isOn = (pack: VendorPermissionPack) => {
    const stored = mv?.packPolicy?.[pack];
    if (typeof stored === "boolean") return stored;
    return LEGACY_POLICY_FLAG_OF_PACK[pack].some((key) => mv?.[key] ?? true);
  };

  return (
    <div className="space-y-4">
      <SettingsTabHeader title={t("title")} description={t("description")} />
      <Card>
        <CardContent className="space-y-4">
          {props.disabled ? (
            <p className="text-sm text-muted-foreground">{t("warning")}</p>
          ) : null}

          <WarningBanner>
            <p className="text-pretty">{t("liveWarning")}</p>
          </WarningBanner>

          <div className="grid gap-2">
            {ALL_VENDOR_PACKS.map((pack) => (
              <div
                key={pack}
                className="flex items-start justify-between gap-4 rounded-xl border px-3.5 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-medium">
                    {tPacks(pack)}
                  </span>
                  <span className="block text-xs text-muted-foreground text-pretty">
                    {t(PACK_BLURB_KEYS[pack])}
                  </span>
                </div>
                <Switch
                  checked={isOn(pack)}
                  disabled={Boolean(props.disabled)}
                  onCheckedChange={(value) =>
                    props.updateField(`multiVendorMode.packPolicy.${pack}`, value)
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
