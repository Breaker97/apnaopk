"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarChart3, MoreVertical, Receipt } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/admin/underline-tabs";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import type { Settings } from "@/components/admin/settings/types";
import type { TaxSettings } from "@/lib/tax/tax-settings";
import type { TaxUsage } from "@/lib/tax/tax-usage";
import { SettingsTabHeader } from "../settings-tab-header";
import { StickySaveFooter } from "../sticky-save-footer";
import { TaxCalculationPanel } from "./tax-calculation-panel";
import { TaxRatesPanel } from "./tax-rates-panel";
import { TaxRegistrationPanel, registrationMissing } from "./tax-registration-panel";
import { TaxVendorsPanel } from "./tax-vendors-panel";
import { taxSettingsOf } from "./tax-shared";

const TABS = ["rates", "registration", "calculation", "vendors"] as const;
type TaxTab = (typeof TABS)[number];
const isTab = (value: string | null | undefined): value is TaxTab =>
  Boolean(value) && (TABS as readonly string[]).includes(value as string);
// Links and bookmarks from when the page had an Overview, a Tax classes and a
// Region & rates tab: classes and rates are one list now.
const LEGACY_TABS: Record<string, TaxTab> = { overview: "rates", classes: "rates", region: "rates" };
/** Four tabs fit a phone only with less room around each (as on Notifications). */
const TAB_CLASS = "gap-1.5 px-2.5 @md:px-4";
const CONTENT_CLASS = "space-y-4 px-3 pt-4 pb-5 @md:px-6 @md:pt-5 @md:pb-6";
const tabFromQuery = (value: string | null | undefined): TaxTab =>
  isTab(value) ? value : (value && LEGACY_TABS[value]) || "rates";

/** Settings → Tax, in four tabs, saved as one section. */
export function TaxSettingsPage(props: { usage: TaxUsage | null }) {
  const { isSaving, dirtySections, updateNestedField, saveSection, discardEdits } =
    useAdminSettingsContext();
  return (
    <SectionLoader>
      {(loadedSettings) => (
        <TaxSettingsTab
          settings={loadedSettings}
          usage={props.usage}
          isSaving={isSaving}
          isDirty={dirtySections.has("tax")}
          updateNestedField={updateNestedField}
          onDiscard={discardEdits}
          onSave={() => saveSection("tax", taxSettingsOf(loadedSettings))}
        />
      )}
    </SectionLoader>
  );
}

export function TaxSettingsTab(props: {
  settings: Settings;
  usage: TaxUsage | null;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
}) {
  const t = useTranslations("admin.settings.tax");
  const tSettings = useTranslations("admin.settings");
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TaxTab>(() => tabFromQuery(searchParams?.get("tab")));
  // The page's moment, fixed while it is open.
  const [now] = useState(() => Date.now());
  const tax = taxSettingsOf(props.settings);
  // Vendors' tax only exists while the store runs as a marketplace.
  const vendorsOn = Boolean(props.settings.multiVendorMode?.enabled);
  const shownTabs = TABS.filter((key) => key !== "vendors" || vendorsOn);
  const activeTab = shownTabs.includes(tab) ? tab : "rates";
  // Written whole: the page always holds the full settings, so what is saved
  // is exactly what is on screen.
  const update = (next: TaxSettings) => props.updateNestedField("tax", next);

  // How many vendor requests wait, for the Vendors tab's badge. Read as the
  // page opens and again whenever the Vendors tab loads or answers its queue.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!vendorsOn) return;
    let live = true;
    fetch("/api/admin/tax-requests?status=pending&limit=1")
      .then((response) => response.json())
      .then((body) => {
        const total = body?.data?.pagination?.total;
        if (live && typeof total === "number") setPending(total);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [vendorsOn]);
  const onPendingCount = useCallback((count: number) => setPending(count), []);

  const openTab = (next: string) => {
    if (!isTab(next)) return;
    setTab(next);
    // Mirrored into the URL so a reload, or a link from elsewhere, lands here.
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  const labels: Record<TaxTab, string> = {
    rates: t("tabs.rates"),
    registration: t("tabs.registration"),
    calculation: t("tabs.calculation"),
    vendors: t("tabs.vendors"),
  };
  // A tax-charging store with no registration number: the tab says so, and the tab explains.
  const needsRegistration = registrationMissing(tax, now);

  return (
    <div className="@container space-y-4">
      <SettingsTabHeader title={t("title")} description={t("description")} />

      <Card className="@container gap-0 py-0">
        <Tabs value={activeTab} onValueChange={openTab}>
          {/* The menu sits beside the tabs, not over them: on a phone the tabs scroll. */}
          <div className="flex items-stretch">
            <div className="min-w-0 flex-1 px-1">
              <UnderlineTabsList aria-label={t("tabsLabel")} className="gap-0 ps-2 @md:gap-1 @md:ps-4">
                {shownTabs.map((key) => (
                  <UnderlineTabsTrigger
                    key={key}
                    value={key}
                    count={key === "vendors" ? pending : undefined}
                    className={TAB_CLASS}
                  >
                    {labels[key]}
                    {key === "registration" && needsRegistration ? (
                      <>
                        <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
                        <span className="sr-only">{t("registrationMissingLabel")}</span>
                      </>
                    ) : null}
                  </UnderlineTabsTrigger>
                ))}
              </UnderlineTabsList>
            </div>
            <div className="flex shrink-0 items-center border-b ps-1 pe-2 @md:pe-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-8"
                    aria-label={t("moreOptions")}
                  >
                    <MoreVertical aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link href="/admin/finance/reports">
                      <BarChart3 aria-hidden />
                      {t("links.report")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/admin/settings/invoices">
                      <Receipt aria-hidden />
                      {t("links.invoices")}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <TabsContent value="rates" className={CONTENT_CLASS}>
            <TaxRatesPanel tax={tax} usage={props.usage} onChange={update} />
          </TabsContent>
          <TabsContent value="registration" className={CONTENT_CLASS}>
            <TaxRegistrationPanel tax={tax} now={now} onChange={update} />
          </TabsContent>
          <TabsContent value="calculation" className={CONTENT_CLASS}>
            <TaxCalculationPanel tax={tax} onChange={update} />
          </TabsContent>
          {vendorsOn ? (
            <TabsContent value="vendors" className={CONTENT_CLASS}>
              <TaxVendorsPanel tax={tax} onChange={update} onPendingCount={onPendingCount} />
            </TabsContent>
          ) : null}
        </Tabs>
      </Card>

      <StickySaveFooter
        label={tSettings("general.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      />
    </div>
  );
}
