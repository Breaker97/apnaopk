"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  Home,
  LayoutGrid,
  Package,
  type LucideIcon,
} from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  BOOST_HOLD_MAX_MINUTES,
  BOOST_HOLD_MIN_MINUTES,
} from "@/config/app.config";
import {
  isPositionUnreachable,
  MAX_PLACEMENT_DEPTH,
} from "@/lib/boosts/boost-placement-depths";
import type { BoostingOverview } from "@/lib/boosts/boosting-overview";
import { formatList } from "@/lib/intl/list";
import { formatCurrency } from "@/lib/intl/money";
import { cn } from "@/lib/utils";
import type { Settings } from "@/components/admin/settings/types";
import { PlatformPaymentMethodsField } from "@/components/admin/settings/fields/platform-payment-methods-field";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
  SettingUnit,
} from "@/components/admin/settings/fields/setting-row";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

const linkClass =
  "text-primary inline-flex items-center gap-1.5 font-medium hover:underline";

/**
 * Settings → Product Boosting: the switch, where sponsored products show,
 * what a vendor can book at one time, and what they can pay with.
 *
 * Pricing lives on the position ladder (/admin/boosts/positions), and the home
 * page's share of the ladder is its sponsored section's size in the page
 * builder — so both are shown here as they stand, with the way to them.
 *
 * Each page has its switch and its depth on one row. They used to be three
 * switches and, further down, two "ladder depth" numbers with the home page's
 * missing, under a note that positions past the largest depth "render
 * nowhere". With the ladder in hand the page says which positions those are,
 * and only when there are any.
 */
export function BoostingSettingsTab(props: {
  settings: Settings;
  /** Whether it is on in the saved copy: the ladder and campaign screens exist only then. */
  savedEnabled: boolean;
  /** The ladder, the pages' depths and the live bookings; null until loaded. */
  overview: BoostingOverview | null;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
}) {
  const t = useTranslations("admin.settings.boosting");
  const tSettings = useTranslations("admin.settings");
  const locale = useLocale();
  const [confirmOff, setConfirmOff] = useState(false);
  const { settings, overview, updateField } = props;
  const boosting = settings.boosting;

  // Boosts are bought by vendors: without Multi-Vendor Mode the storefront and
  // every boost endpoint treat the feature as off, whatever this switch says.
  const vendorsOn = Boolean(settings.multiVendorMode?.enabled);
  const enabled = vendorsOn && (boosting?.enabled ?? false);

  const placements = {
    home: boosting?.placements?.home ?? true,
    listing: boosting?.placements?.listing ?? true,
    productPage: boosting?.placements?.productPage ?? true,
  };
  const listingTop = boosting?.listingSlots ?? 2;
  const productTop = boosting?.productPageSlots ?? 8;
  const windowDays = boosting?.bookingHorizonDays ?? 60;
  const longestDays = boosting?.maxBookingDays ?? 60;

  // A published page with no sponsored section reports a depth of 0.
  const homeTop = overview?.depths.home;
  const productSection = overview ? overview.depths.productPage > 0 : true;

  const setWhole = (path: string) => (next: number | undefined) => {
    if (next !== undefined) updateField(path, next);
  };

  /** The rungs on sale that no page would show with what the form holds now. */
  const unseen = overview
    ? overview.positions.filter((rung) =>
        isPositionUnreachable(
          rung.position,
          {
            home: overview.depths.home,
            listing: listingTop,
            productPage: productSection ? productTop : 0,
          },
          placements,
        ),
      )
    : [];
  const nothingShows =
    overview !== null &&
    !(placements.home && overview.depths.home > 0) &&
    !placements.listing &&
    !(placements.productPage && productSection);
  const reachWarning = nothingShows
    ? t("surfaces.unseenAll")
    : unseen.length === 1
      ? t("surfaces.unseenOne", {
          position: unseen[0].position,
          name: unseen[0].label,
        })
      : unseen.length > 1
        ? t("surfaces.unseenMany", {
            positions: formatList(
              unseen.map((rung) => String(rung.position)),
              locale,
            ),
          })
        : null;

  const ladderSummary = (() => {
    if (!overview || overview.positions.length === 0) return null;
    const count = overview.positions.length;
    // A rung left in an earlier store currency is flagged on the ladder itself.
    const prices = overview.positions
      .filter((rung) => rung.currency?.toUpperCase() === overview.currency)
      .map((rung) => rung.pricePerDay);
    if (prices.length === 0) return t("ladder.count", { count });
    const money = (amount: number) => formatCurrency(amount, overview.currency, locale);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max
      ? t("ladder.onePrice", { count, price: money(min) })
      : t("ladder.range", { count, min: money(min), max: money(max) });
  })();

  const bookings = overview?.bookings;

  const toggle = (on: boolean) => {
    if (on) {
      updateField("boosting.enabled", true);
      return;
    }
    // Nothing was on sale yet, or nothing is booked: nothing to warn about.
    const live = bookings ? bookings.running + bookings.upcoming : null;
    if (!props.savedEnabled || live === 0) {
      updateField("boosting.enabled", false);
      return;
    }
    setConfirmOff(true);
  };

  const topInput = (path: string, value: number, label: string) => (
    <span className="text-muted-foreground flex items-center gap-2 text-sm">
      {t.rich("surfaces.top", {
        input: () => (
          <NumberInput
            aria-label={label}
            className="w-16"
            min={1}
            max={MAX_PLACEMENT_DEPTH}
            step={1}
            normalize={Math.trunc}
            whenEmpty="keep"
            value={value}
            onValueChange={setWhole(path)}
          />
        ),
      })}
    </span>
  );

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("title")}
        description={!vendorsOn || enabled ? t("description") : t("descriptionOff")}
        control={
          vendorsOn ? (
            <Switch
              className="mt-1"
              checked={enabled}
              aria-label={t("title")}
              onCheckedChange={toggle}
            />
          ) : undefined
        }
      >
        {!vendorsOn ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 basis-64 text-sm">{t("needsVendors")}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/settings/marketplace">{t("openMultiVendor")}</Link>
            </Button>
          </div>
        ) : enabled && props.savedEnabled ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Link href="/admin/boosts/positions" className={linkClass}>
                  {t("links.ladder")}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
                {ladderSummary ? (
                  <span className="text-muted-foreground">{ladderSummary}</span>
                ) : null}
              </span>
              <Link href="/admin/boosts" className={linkClass}>
                {t("links.campaigns")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </div>
            {overview && overview.positions.length === 0 ? (
              <WarningBanner>{t("ladder.empty")}</WarningBanner>
            ) : null}
          </div>
        ) : null}
      </SettingsTabHeader>

      {enabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("surfaces.title")}</CardTitle>
              <CardDescription>{t("surfaces.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SettingList>
                {/* One grid with room, each row a subgrid of it, so the depths
                    line up in a column as wide as the longest of them: eleven
                    fixed rems broke "Izikhundla eziphezulu ezi-8" in two. */}
                <div className="divide-y @xl:grid @xl:grid-cols-[auto_minmax(12rem,1fr)_auto_auto] @xl:gap-x-4">
                  <PlacementRow
                    icon={Home}
                    title={t("surfaces.home")}
                    hint={
                      homeTop === 0
                        ? t.rich("surfaces.homeMissing", {
                            link: (chunks) => <PageBuilderLink>{chunks}</PageBuilderLink>,
                          })
                        : t.rich("surfaces.homeHint", {
                            link: (chunks) => <PageBuilderLink>{chunks}</PageBuilderLink>,
                          })
                    }
                    caution={homeTop === 0}
                    top={
                      placements.home && homeTop ? (
                        <span className="text-muted-foreground text-sm">
                          {t("surfaces.topFixed", { count: homeTop })}
                        </span>
                      ) : null
                    }
                    checked={placements.home}
                    onCheckedChange={(on) => updateField("boosting.placements.home", on)}
                  />
                  <PlacementRow
                    icon={LayoutGrid}
                    title={t("surfaces.listing")}
                    hint={t("surfaces.listingHint")}
                    top={
                      placements.listing
                        ? topInput(
                            "boosting.listingSlots",
                            listingTop,
                            t("surfaces.topLabel", { page: t("surfaces.listing") }),
                          )
                        : null
                    }
                    checked={placements.listing}
                    onCheckedChange={(on) => updateField("boosting.placements.listing", on)}
                  />
                  <PlacementRow
                    icon={Package}
                    title={t("surfaces.productPage")}
                    hint={
                      productSection
                        ? t("surfaces.productPageHint")
                        : t.rich("surfaces.productPageMissing", {
                            link: (chunks) => (
                              <PageBuilderLink page="template:product">{chunks}</PageBuilderLink>
                            ),
                          })
                    }
                    caution={!productSection}
                    top={
                      placements.productPage && productSection
                        ? topInput(
                            "boosting.productPageSlots",
                            productTop,
                            t("surfaces.topLabel", { page: t("surfaces.productPage") }),
                          )
                        : null
                    }
                    checked={placements.productPage}
                    onCheckedChange={(on) =>
                      updateField("boosting.placements.productPage", on)
                    }
                  />
                </div>
              </SettingList>

              {reachWarning ? <WarningBanner>{reachWarning}</WarningBanner> : null}

              <SettingList>
                <SettingSwitchItem
                  title={t("surfaces.hideOutOfStock")}
                  description={t("surfaces.hideOutOfStockHint")}
                  checked={boosting?.hideOutOfStock ?? true}
                  onCheckedChange={(on) => updateField("boosting.hideOutOfStock", on)}
                />
              </SettingList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("rules.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingList>
                <SettingRow
                  inputId="boostBookingWindow"
                  label={t("rules.window")}
                  hint={t("rules.windowHint")}
                >
                  <NumberInput
                    id="boostBookingWindow"
                    className="w-20"
                    min={7}
                    max={365}
                    step={1}
                    normalize={Math.trunc}
                    whenEmpty="keep"
                    value={windowDays}
                    onValueChange={setWhole("boosting.bookingHorizonDays")}
                  />
                  <SettingUnit>{t("rules.days")}</SettingUnit>
                </SettingRow>
                <SettingRow
                  inputId="boostLongestBooking"
                  label={t("rules.longest")}
                  hint={
                    // Checkout enforces both, so the smaller one is the limit.
                    longestDays > windowDays ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {t("rules.longestOverWindow")}
                      </span>
                    ) : (
                      t("rules.longestHint")
                    )
                  }
                >
                  <NumberInput
                    id="boostLongestBooking"
                    className="w-20"
                    min={1}
                    max={365}
                    step={1}
                    normalize={Math.trunc}
                    whenEmpty="keep"
                    value={longestDays}
                    onValueChange={setWhole("boosting.maxBookingDays")}
                  />
                  <SettingUnit>{t("rules.days")}</SettingUnit>
                </SettingRow>
                <SettingRow
                  inputId="boostCheckoutHold"
                  label={t("rules.hold")}
                  hint={t("rules.holdHint", { minutes: BOOST_HOLD_MIN_MINUTES })}
                >
                  <NumberInput
                    id="boostCheckoutHold"
                    className="w-20"
                    min={BOOST_HOLD_MIN_MINUTES}
                    max={BOOST_HOLD_MAX_MINUTES}
                    step={1}
                    normalize={Math.trunc}
                    whenEmpty="keep"
                    value={boosting?.holdMinutes ?? 45}
                    onValueChange={setWhole("boosting.holdMinutes")}
                  />
                  <SettingUnit>{t("rules.minutes")}</SettingUnit>
                </SettingRow>
              </SettingList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("payments.title")}</CardTitle>
              <CardDescription>
                {t.rich("payments.description", {
                  link: (chunks) => (
                    <Link
                      href="/admin/settings/payment"
                      className="text-primary font-medium hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlatformPaymentMethodsField
                settings={settings}
                value={boosting?.paymentMethods}
                onChange={(key, on) => updateField(`boosting.paymentMethods.${key}`, on)}
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      <StickySaveFooter
        label={tSettings("general.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      />

      {/* Switching boosting off touches no booking: the storefront just stops
          rendering them, and nothing credits the days that then pass unshown.
          So the dialog says how many there are and where to settle them. */}
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        onConfirm={() => {
          updateField("boosting.enabled", false);
          setConfirmOff(false);
        }}
        type="warning"
        confirmVariant="destructive"
        title={t("turnOff.title")}
        description={t("turnOff.description")}
        confirmText={t("turnOff.confirm")}
        cancelText={t("turnOff.cancel")}
      >
        <WarningBanner
          title={
            bookings
              ? t("turnOff.bookings", {
                  running: bookings.running,
                  upcoming: bookings.upcoming,
                })
              : t("turnOff.bookingsUnknown")
          }
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/boosts">{t("links.campaigns")}</Link>
            </Button>
          }
        >
          {t("turnOff.notCredited")}
        </WarningBanner>
      </ConfirmDialog>
    </div>
  );
}

/** A link into the page builder: the home page, or the page named. */
function PageBuilderLink(props: { page?: string; children: ReactNode }) {
  return (
    <Link
      href={
        props.page
          ? `/admin/online-store/customize?page=${encodeURIComponent(props.page)}`
          : "/admin/online-store/customize"
      }
      className="text-primary font-medium hover:underline"
    >
      {props.children}
    </Link>
  );
}

/**
 * One storefront page that can show sponsored products: what it is, how many
 * of the ladder's top positions it shows, and its switch.
 *
 * It lays out by the list's width: with room, the depth and the switch sit
 * beside the text in the list's own columns (the rows are subgrids of it), so
 * they line up down the list; without, the switch stays beside the name and
 * the rest stacks under it.
 */
function PlacementRow(props: {
  icon: LucideIcon;
  title: string;
  hint: ReactNode;
  /** The hint reports something wrong with the page rather than describing it. */
  caution?: boolean;
  /** "Top N positions"; left out while the page shows none. */
  top: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const Icon = props.icon;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 p-4 @xl:col-span-full @xl:grid-cols-subgrid @xl:gap-x-4 @xl:gap-y-0.5">
      <span
        aria-hidden
        className="bg-muted text-muted-foreground flex h-9 w-9 items-center justify-center rounded-md @xl:row-span-2"
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-sm font-medium">{props.title}</p>
      <p
        className={cn(
          "col-span-3 row-start-2 text-sm @xl:col-start-2",
          // With no depth beside it, the text takes that column too.
          props.top ? "@xl:col-span-1" : "@xl:col-span-2",
          props.caution
            ? "text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {props.hint}
      </p>
      {props.top ? (
        <div className="col-span-3 row-start-3 @xl:col-span-1 @xl:col-start-3 @xl:row-span-2 @xl:row-start-1">
          {props.top}
        </div>
      ) : null}
      <Switch
        className="col-start-3 row-start-1 @xl:col-start-4 @xl:row-span-2"
        checked={props.checked}
        aria-label={props.title}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  );
}
