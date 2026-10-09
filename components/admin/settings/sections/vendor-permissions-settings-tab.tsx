"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import {
  BadgePercent,
  ChartColumn,
  ClipboardList,
  Inbox,
  Monitor,
  Package,
  Rocket,
  Sparkles,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  FeatureGroup,
  FeatureRow,
} from "@/components/admin/settings/fields/feature-row";
import {
  LEGACY_POLICY_FLAG_OF_PACK,
  type VendorPermissionPack,
  type VendorPolicyFlags,
} from "@/config/permissions.config";
import type { Settings } from "@/components/admin/settings/types";

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

const PACK_ICONS: Record<
  VendorPermissionPack,
  ComponentType<{ className?: string }>
> = {
  catalog: Package,
  orders: ClipboardList,
  storefront: Store,
  analytics: ChartColumn,
  inbox: Inbox,
  staff: Users,
  discounts: BadgePercent,
  pos: Monitor,
  payouts: Wallet,
  boosts: Rocket,
  aiStudio: Sparkles,
};

export type PackGroupId = "selling" | "store" | "money" | "insights";

/**
 * The eleven switches in four short lists. Every pack sits in exactly one
 * (tests/vendor-permissions-settings.test.tsx), so a pack added to
 * config/permissions.config.ts fails a test until it is placed here.
 */
export const PACK_GROUPS: ReadonlyArray<{
  id: PackGroupId;
  packs: readonly VendorPermissionPack[];
}> = [
  { id: "selling", packs: ["catalog", "orders", "discounts", "pos"] },
  { id: "store", packs: ["storefront", "staff", "inbox"] },
  { id: "money", packs: ["payouts", "boosts"] },
  { id: "insights", packs: ["analytics", "aiStudio"] },
];

type PolicySettings = Settings["multiVendorMode"] &
  Partial<VendorPolicyFlags> & {
    packPolicy?: Partial<Record<VendorPermissionPack, boolean>>;
  };

/**
 * Whether a pack is on, with the fallback the server applies: a store that
 * has not been migrated has no `packPolicy` yet, and each pack then follows
 * the `multiVendorMode.can*` boolean it used to sit under.
 *
 * Exported for the pages whose own switch does nothing while a pack is off
 * (Settings → Point of Sale's "Vendors").
 */
export function isPackOn(
  settings: Settings["multiVendorMode"] | undefined,
  pack: VendorPermissionPack,
) {
  const mv = settings as PolicySettings | undefined;
  const stored = mv?.packPolicy?.[pack];
  if (typeof stored === "boolean") return stored;
  return LEGACY_POLICY_FLAG_OF_PACK[pack].some((key) => mv?.[key] ?? true);
}

/**
 * Settings → Multi-Vendor Mode → Marketplace policy.
 *
 * One switch per capability pack — the outermost of the four access layers,
 * and a platform-wide kill switch rather than a default for new vendors:
 * turning one off takes the capability from every existing store on the next
 * request. That used to be an amber box over the whole list, always; now the
 * warning appears under a switch only while it is turned off and unsaved,
 * measured against the saved copy.
 *
 * It used to be eight `multiVendorMode.can*` booleans covering eleven packs, so
 * "Manage Store Settings" silently carried Staff and the Inbox with it
 * (guideline P5). Now a switch reaches exactly as far as its label.
 */
export function VendorPermissionsSettingsTab(props: {
  settings: Settings;
  /** The saved copy; without it no switch reads as newly turned off. */
  savedSettings?: Settings | null;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.vendorPermissions");
  const tPacks = useTranslations("permissionPacks");
  const current = props.settings.multiVendorMode as PolicySettings;
  const saved = (props.savedSettings?.multiVendorMode ?? current) as PolicySettings;

  const groupTitles: Record<PackGroupId, string> = {
    selling: t("groups.selling"),
    store: t("groups.store"),
    money: t("groups.money"),
    insights: t("groups.insights"),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {PACK_GROUPS.map((group) => (
          <FeatureGroup key={group.id} title={groupTitles[group.id]}>
            {group.packs.map((pack) => {
              const on = isPackOn(current, pack);
              const turningOff = !on && isPackOn(saved, pack);
              return (
                <FeatureRow
                  key={pack}
                  icon={PACK_ICONS[pack]}
                  title={tPacks(pack)}
                  description={t(PACK_BLURB_KEYS[pack])}
                  checked={on}
                  onCheckedChange={(value) =>
                    props.updateField(`multiVendorMode.packPolicy.${pack}`, value)
                  }
                >
                  {turningOff ? (
                    <WarningBanner className="mx-4 mb-4 py-2.5 sm:ms-16">
                      {t("turningOff", { pack: tPacks(pack) })}
                    </WarningBanner>
                  ) : null}
                </FeatureRow>
              );
            })}
          </FeatureGroup>
        ))}
      </CardContent>
    </Card>
  );
}
