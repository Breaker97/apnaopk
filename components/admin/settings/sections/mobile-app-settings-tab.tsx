"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Settings } from "@/components/admin/settings/types";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { SettingSwitchRow } from "@/components/admin/settings/fields/setting-switch-row";
import { credentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

const TOKEN_PATH = "mobileApp.shop.expoAccessToken";

/**
 * Settings → Mobile app: the switch for the shopper app's API, the app's link
 * scheme, each platform's app identity and the versions it must be on, and
 * push. The identity fields are what the store's links need to open in the
 * app (/.well-known/apple-app-site-association and assetlinks.json, built in
 * lib/settings/mobile-app-links.ts): iOS the bundle and team IDs, Android
 * the package name and its signing fingerprints.
 *
 * Then the business app (the store's operators): its own switch, scheme
 * (never the shopper app's, checked on save) and versions. It opens no store
 * links, so it has no link identity; push goes out with the one token below.
 */
export function MobileAppSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;
  const shop = settings.mobileApp?.shop ?? {};
  const biz = settings.mobileApp?.biz ?? {};
  const token = credentialMeta(settings, TOKEN_PATH);

  const platforms = [
    {
      id: "ios",
      title: t("admin.settings.mobileApp.iosTitle"),
      block: shop.ios ?? {},
      storeUrlKey: "appStoreUrl",
      storeUrlLabel: t("admin.settings.mobileApp.appStoreUrl"),
      storeUrlSample: "https://apps.apple.com/app/id0000000000",
    },
    {
      id: "android",
      title: t("admin.settings.mobileApp.androidTitle"),
      block: shop.android ?? {},
      storeUrlKey: "playStoreUrl",
      storeUrlLabel: t("admin.settings.mobileApp.playStoreUrl"),
      storeUrlSample: "https://play.google.com/store/apps/details?id=com.example.store",
    },
  ] as const;

  return (
    <div className="space-y-4 pb-24">
      <SettingsTabHeader
        title={t("admin.settings.mobileApp.title")}
        description={t("admin.settings.mobileApp.description")}
      />

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="rounded-lg border p-4">
            <SettingSwitchRow
              id="mobileAppEnabled"
              title={t("admin.settings.mobileApp.apiTitle")}
              description={t("admin.settings.mobileApp.apiDesc")}
              checked={Boolean(shop.enabled)}
              onCheckedChange={(value) =>
                updateNestedField("mobileApp.shop.enabled", value)
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mobileAppScheme">
              {t("admin.settings.mobileApp.scheme")}
            </Label>
            <Input
              id="mobileAppScheme"
              value={shop.scheme ?? ""}
              placeholder="mystore"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) =>
                updateNestedField("mobileApp.shop.scheme", event.target.value)
              }
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.mobileApp.schemeHelp")}
            </p>
          </div>
        </CardContent>
      </Card>

      {platforms.map((platform) => (
        <Card key={platform.id}>
          <CardContent className="space-y-4 pt-6">
            <h4 className="font-medium">{platform.title}</h4>
            {platform.id === "ios" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="iosBundleId">
                    {t("admin.settings.mobileApp.bundleId")}
                  </Label>
                  <Input
                    id="iosBundleId"
                    value={shop.ios?.bundleId ?? ""}
                    placeholder="com.example.store"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) =>
                      updateNestedField("mobileApp.shop.ios.bundleId", event.target.value)
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("admin.settings.mobileApp.bundleIdHelp")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="iosTeamId">
                    {t("admin.settings.mobileApp.teamId")}
                  </Label>
                  <Input
                    id="iosTeamId"
                    value={shop.ios?.teamId ?? ""}
                    placeholder="ABCDE12345"
                    autoCapitalize="characters"
                    spellCheck={false}
                    onChange={(event) =>
                      updateNestedField("mobileApp.shop.ios.teamId", event.target.value)
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("admin.settings.mobileApp.teamIdHelp")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="androidPackageName">
                    {t("admin.settings.mobileApp.packageName")}
                  </Label>
                  <Input
                    id="androidPackageName"
                    value={shop.android?.packageName ?? ""}
                    placeholder="com.example.store"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) =>
                      updateNestedField(
                        "mobileApp.shop.android.packageName",
                        event.target.value,
                      )
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("admin.settings.mobileApp.packageNameHelp")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="androidFingerprints">
                    {t("admin.settings.mobileApp.fingerprints")}
                  </Label>
                  {/* One per line; the save trims, upper-cases and drops blank lines. */}
                  <Textarea
                    id="androidFingerprints"
                    rows={3}
                    className="font-mono text-xs"
                    value={(shop.android?.sha256CertFingerprints ?? []).join("\n")}
                    placeholder="AB:CD:…:EF"
                    spellCheck={false}
                    onChange={(event) =>
                      updateNestedField(
                        "mobileApp.shop.android.sha256CertFingerprints",
                        event.target.value.split("\n"),
                      )
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("admin.settings.mobileApp.fingerprintsHelp")}
                  </p>
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${platform.id}MinVersion`}>
                  {t("admin.settings.mobileApp.minVersion")}
                </Label>
                <Input
                  id={`${platform.id}MinVersion`}
                  value={platform.block.minVersion ?? ""}
                  placeholder="1.0.0"
                  inputMode="decimal"
                  onChange={(event) =>
                    updateNestedField(
                      `mobileApp.shop.${platform.id}.minVersion`,
                      event.target.value,
                    )
                  }
                />
                <p className="text-sm text-muted-foreground">
                  {t("admin.settings.mobileApp.minVersionHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${platform.id}LatestVersion`}>
                  {t("admin.settings.mobileApp.latestVersion")}
                </Label>
                <Input
                  id={`${platform.id}LatestVersion`}
                  value={platform.block.latestVersion ?? ""}
                  placeholder="1.2.0"
                  inputMode="decimal"
                  onChange={(event) =>
                    updateNestedField(
                      `mobileApp.shop.${platform.id}.latestVersion`,
                      event.target.value,
                    )
                  }
                />
                <p className="text-sm text-muted-foreground">
                  {t("admin.settings.mobileApp.latestVersionHelp")}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${platform.id}StoreUrl`}>
                {platform.storeUrlLabel}
              </Label>
              <Input
                id={`${platform.id}StoreUrl`}
                type="url"
                value={
                  (platform.block as Record<string, string | undefined>)[
                    platform.storeUrlKey
                  ] ?? ""
                }
                placeholder={platform.storeUrlSample}
                onChange={(event) =>
                  updateNestedField(
                    `mobileApp.shop.${platform.id}.${platform.storeUrlKey}`,
                    event.target.value,
                  )
                }
              />
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-1">
            <h4 className="font-medium">{t("admin.settings.mobileApp.bizTitle")}</h4>
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.mobileApp.bizDescription")}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <SettingSwitchRow
              id="mobileAppBizEnabled"
              title={t("admin.settings.mobileApp.bizApiTitle")}
              description={t("admin.settings.mobileApp.bizApiDesc")}
              checked={Boolean(biz.enabled)}
              onCheckedChange={(value) =>
                updateNestedField("mobileApp.biz.enabled", value)
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mobileAppBizScheme">
              {t("admin.settings.mobileApp.bizScheme")}
            </Label>
            <Input
              id="mobileAppBizScheme"
              value={biz.scheme ?? ""}
              placeholder="mystorebiz"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) =>
                updateNestedField("mobileApp.biz.scheme", event.target.value)
              }
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.mobileApp.bizSchemeHelp")}
            </p>
          </div>

          {(
            [
              {
                id: "ios",
                title: t("admin.settings.mobileApp.iosTitle"),
                block: biz.ios ?? {},
                identityKey: "bundleId",
                identityLabel: t("admin.settings.mobileApp.bundleId"),
                identityHelp: t("admin.settings.mobileApp.bizBundleIdHelp"),
                identitySample: "com.example.business",
                storeUrlKey: "appStoreUrl",
                storeUrlLabel: t("admin.settings.mobileApp.appStoreUrl"),
                storeUrlSample: "https://apps.apple.com/app/id0000000000",
              },
              {
                id: "android",
                title: t("admin.settings.mobileApp.androidTitle"),
                block: biz.android ?? {},
                identityKey: "packageName",
                identityLabel: t("admin.settings.mobileApp.packageName"),
                identityHelp: t("admin.settings.mobileApp.bizPackageNameHelp"),
                identitySample: "com.example.business",
                storeUrlKey: "playStoreUrl",
                storeUrlLabel: t("admin.settings.mobileApp.playStoreUrl"),
                storeUrlSample:
                  "https://play.google.com/store/apps/details?id=com.example.business",
              },
            ] as const
          ).map((platform) => {
            const block = platform.block as Record<string, string | undefined>;
            const path = `mobileApp.biz.${platform.id}`;
            return (
              <div key={platform.id} className="space-y-4 border-t pt-4">
                <h5 className="text-sm font-medium">{platform.title}</h5>
                <div className="space-y-2">
                  <Label htmlFor={`biz${platform.id}Identity`}>
                    {platform.identityLabel}
                  </Label>
                  <Input
                    id={`biz${platform.id}Identity`}
                    value={block[platform.identityKey] ?? ""}
                    placeholder={platform.identitySample}
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) =>
                      updateNestedField(
                        `${path}.${platform.identityKey}`,
                        event.target.value,
                      )
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {platform.identityHelp}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`biz${platform.id}MinVersion`}>
                      {t("admin.settings.mobileApp.minVersion")}
                    </Label>
                    <Input
                      id={`biz${platform.id}MinVersion`}
                      value={block.minVersion ?? ""}
                      placeholder="1.0.0"
                      inputMode="decimal"
                      onChange={(event) =>
                        updateNestedField(`${path}.minVersion`, event.target.value)
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.mobileApp.bizMinVersionHelp")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`biz${platform.id}LatestVersion`}>
                      {t("admin.settings.mobileApp.latestVersion")}
                    </Label>
                    <Input
                      id={`biz${platform.id}LatestVersion`}
                      value={block.latestVersion ?? ""}
                      placeholder="1.2.0"
                      inputMode="decimal"
                      onChange={(event) =>
                        updateNestedField(
                          `${path}.latestVersion`,
                          event.target.value,
                        )
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.mobileApp.latestVersionHelp")}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`biz${platform.id}StoreUrl`}>
                    {platform.storeUrlLabel}
                  </Label>
                  <Input
                    id={`biz${platform.id}StoreUrl`}
                    type="url"
                    value={block[platform.storeUrlKey] ?? ""}
                    placeholder={platform.storeUrlSample}
                    onChange={(event) =>
                      updateNestedField(
                        `${path}.${platform.storeUrlKey}`,
                        event.target.value,
                      )
                    }
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="rounded-lg border p-4">
            <SettingSwitchRow
              id="mobileAppDigitalPurchases"
              title={t("admin.settings.mobileApp.digitalTitle")}
              description={t("admin.settings.mobileApp.digitalDesc")}
              checked={Boolean(shop.allowDigitalPurchases)}
              onCheckedChange={(value) =>
                updateNestedField("mobileApp.shop.allowDigitalPurchases", value)
              }
            />
          </div>

          <div className="space-y-2">
            <SecretInput
              id="mobileAppExpoAccessToken"
              label={t("admin.settings.mobileApp.expoAccessToken")}
              value={shop.expoAccessToken ?? ""}
              onChange={(value) => updateNestedField(TOKEN_PATH, value)}
              onClear={() => updateNestedField(TOKEN_PATH, null)}
              secretSet={token.set}
              maskedHint={token.hint}
              placeholderWhenUnset={t(
                "admin.settings.mobileApp.expoAccessTokenPlaceholder",
              )}
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.mobileApp.expoAccessTokenHelp")}
            </p>
            <EnvSourceHint
              show={Boolean(settings._meta?.envSources?.mobileApp?.expoAccessToken)}
            />
          </div>

          <StickySaveFooter
            label={t("admin.settings.mobileApp.save")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
