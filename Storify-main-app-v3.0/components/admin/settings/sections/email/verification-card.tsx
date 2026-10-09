"use client";

import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  SettingList,
  SettingSwitchItem,
} from "@/components/admin/settings/fields/setting-row";
import type { Settings } from "@/components/admin/settings/types";
import { VERIFICATION_CARD_ID } from "./mail-server-card";

/**
 * New accounts confirm their email before they can sign in. It sat at the top
 * of the SMTP card in a grey box, though it is a sign-up rule, and it can only
 * be switched on once the mail server passed a test: the save used to fail
 * with that sentence instead of the page saying it first.
 *
 * Admins and staff never verify (lib/auth/email-verification-policy.ts).
 * Accounts made before it was switched on keep working and are reminded.
 */
export function VerificationCard({
  settings,
  showVendors,
  canTurnOn,
  needReason,
  failing,
  updateField,
}: {
  settings: Settings;
  /** With Multi-Vendor Mode on, or while the vendor rule is still on. */
  showVendors: boolean;
  /** The saved server passed a test and has no unsaved change. */
  canTurnOn: boolean;
  /** Why it cannot be switched on yet; null when it can. */
  needReason: "test" | "save" | null;
  /** Verification is on and the newest email failed: links are not arriving. */
  failing: boolean;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.email.verification");
  const customers = Boolean(settings.security?.emailVerificationRequired);
  const vendors = Boolean(settings.security?.emailVerificationForVendors);
  const anyOn = customers || (showVendors && vendors);

  return (
    <Card id={VERIFICATION_CARD_ID} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SettingList>
          <SettingSwitchItem
            title={t("customers")}
            checked={customers}
            // Switching it off is always allowed; on needs a tested server.
            disabled={!customers && !canTurnOn}
            onCheckedChange={(on) =>
              updateField("security.emailVerificationRequired", on)
            }
          />
          {showVendors ? (
            <SettingSwitchItem
              title={t("vendors")}
              description={t("vendorsHint")}
              checked={vendors}
              disabled={!vendors && !canTurnOn}
              onCheckedChange={(on) =>
                updateField("security.emailVerificationForVendors", on)
              }
            />
          ) : null}
        </SettingList>
        {!anyOn && needReason ? (
          <p className="text-muted-foreground text-sm">
            {needReason === "test" ? t("needTest") : t("needSave")}
          </p>
        ) : null}
        {failing ? (
          <WarningBanner title={t("failingTitle")}>{t("failing")}</WarningBanner>
        ) : null}
      </CardContent>
    </Card>
  );
}
