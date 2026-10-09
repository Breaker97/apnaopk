"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Banknote,
  Building2,
  CreditCard,
  Play,
  ShieldCheck,
  Store,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "@/components/language/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { WarningBanner } from "@/components/ui/warning-banner";
import { previewPOSSound } from "@/lib/pos/pos-sounds";
import type { Settings } from "@/components/admin/settings/types";
import { FeatureRow } from "@/components/admin/settings/fields/feature-row";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
} from "@/components/admin/settings/fields/setting-row";
import type { POSLocationList } from "@/components/admin/settings/use-pos-locations";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { isPackOn } from "./vendor-permissions-settings-tab";

const linkClass = "text-primary font-medium hover:underline";
const cautionClass = "text-amber-700 dark:text-amber-400";

/** The ways to pay, in the order the register lists them (components/pos/take-payment-dialog.tsx). */
const PAYMENT_ORDER = ["cash", "card", "bank", "manual"] as const;
type PaymentMethod = (typeof PAYMENT_ORDER)[number];
/** What a store that never saved the list takes (lib/pos/payment.ts). */
const DEFAULT_PAYMENT_METHODS: readonly string[] = ["cash", "card"];

/** The number after the prefix in the example; lib/orders/order-number.ts pads to six digits. */
const EXAMPLE_ORDER_SEQUENCE = "000017";

/** The select's value for "no default counter"; the setting itself is then empty. */
const NO_COUNTER = "none";

/** For `t.rich`: the tagged words of a message, as a link to another admin page. */
function linkTo(href: string) {
  return function RichLink(chunks: ReactNode) {
    return (
      <Link href={href} className={linkClass}>
        {chunks}
      </Link>
    );
  };
}

/**
 * Settings → Point of Sale: the switch, who can open the register, what it
 * takes as payment, how a register is set up, and its sounds.
 *
 * With POS off the page is its header: nothing below applies, and six greyed
 * cards used to say so at length. Each switch is here once. The state used to
 * be told three times over (a badge, a card named after the switch, and the
 * switch row under it).
 *
 * Two controls say what else they depend on, because each did nothing on its
 * own and the page never said so: "Vendors" needs Multi-Vendor Mode's Point of
 * Sale permission, and "Staff" needs the staff member's own.
 *
 * There is no "Offline payments" switch. Nothing read it: a register that
 * loses its connection queues its sales whatever the switch said
 * (hooks/use-pos-offline.ts).
 */
export function POSSettingsTab(props: {
  settings: Settings;
  /** The store's locations, for the default counter (usePOSLocations). */
  locations: POSLocationList;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
}) {
  const t = useTranslations("admin.settings.pos");
  const tSettings = useTranslations("admin.settings");
  const locale = useLocale();
  const { settings, updateField } = props;
  const pos = settings.pos;
  const enabled = Boolean(pos.enabled);

  // A vendor's dashboard exists only with Multi-Vendor Mode on, so a store
  // without vendors has no vendor register to allow.
  const vendorsOn = Boolean(settings.multiVendorMode?.enabled);
  const vendorsAllowed = Boolean(pos.allowVendorSales);
  const nobody =
    !pos.allowAdminSales && !pos.allowSellerSales && !(vendorsOn && vendorsAllowed);
  const vendorPackOff = vendorsAllowed && !isPackOn(settings.multiVendorMode, "pos");

  const storedMethods: readonly string[] =
    pos.checkout?.paymentMethods ?? DEFAULT_PAYMENT_METHODS;
  const methods = PAYMENT_ORDER.filter((method) => storedMethods.includes(method));
  const setMethod = (method: PaymentMethod, on: boolean) => {
    updateField(
      "pos.checkout.paymentMethods",
      // In the register's order, so switching one off and on again is no edit.
      PAYMENT_ORDER.filter((entry) =>
        entry === method ? on : methods.includes(entry),
      ),
    );
  };
  // The register takes a card on a reader, or typed in through Stripe. Without
  // Stripe only the reader works, which is a way to run a shop, not a fault.
  const stripeReady =
    Boolean(settings.payment?.stripe?.enabled) &&
    settings._meta?.checkoutGateways?.stripe?.ready !== false;

  const customize = pos.customize;
  const printing = Boolean(customize?.printedReceiptsEnabled);
  const soundOn = customize?.soundEnabled !== false;
  const volume = customize?.soundVolume ?? 50;
  const prefix = pos.orders?.orderNumberPrefix ?? "POS";

  const paymentOptions: Array<{
    method: PaymentMethod;
    icon: LucideIcon;
    name: string;
    note: ReactNode;
  }> = [
    {
      method: "cash",
      icon: Banknote,
      name: t("paymentCash"),
      note: t("paymentCashDesc"),
    },
    {
      method: "card",
      icon: CreditCard,
      name: t("paymentCard"),
      note: stripeReady
        ? t("paymentCardDesc")
        : t.rich("paymentCardNoStripe", {
            link: linkTo("/admin/settings/payment"),
          }),
    },
    {
      method: "bank",
      icon: Building2,
      name: t("paymentBank"),
      note: t("paymentBankDesc"),
    },
    {
      method: "manual",
      icon: Tag,
      name: t("paymentManual"),
      note: t("paymentManualDesc"),
    },
  ];

  const sounds = [
    { key: "soundAddToCart", type: "addToCart", name: t("soundAddToCart") },
    { key: "soundPayment", type: "payment", name: t("soundPayment") },
    { key: "soundOrderComplete", type: "orderComplete", name: t("soundOrderComplete") },
    { key: "soundError", type: "error", name: t("soundError") },
  ] as const;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("title")}
        description={enabled ? t("description") : t("descriptionOff")}
        control={
          <Switch
            className="mt-1"
            checked={enabled}
            aria-label={t("title")}
            onCheckedChange={(on) => updateField("pos.enabled", on)}
          />
        }
      />

      {enabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("access")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SettingList>
                <FeatureRow
                  icon={ShieldCheck}
                  title={t("admin")}
                  description={t("adminDesc")}
                  checked={Boolean(pos.allowAdminSales)}
                  onCheckedChange={(on) => updateField("pos.allowAdminSales", on)}
                />
                {vendorsOn ? (
                  <FeatureRow
                    icon={Store}
                    title={t("vendor")}
                    description={
                      vendorPackOff ? (
                        <span className={cautionClass}>
                          {t.rich("vendorPackOff", {
                            link: linkTo("/admin/settings/marketplace"),
                          })}
                        </span>
                      ) : (
                        t("vendorDesc")
                      )
                    }
                    checked={vendorsAllowed}
                    onCheckedChange={(on) => updateField("pos.allowVendorSales", on)}
                  />
                ) : null}
                <FeatureRow
                  icon={Users}
                  title={t("seller")}
                  description={t.rich("sellerDesc", { link: linkTo("/admin/staff") })}
                  checked={Boolean(pos.allowSellerSales)}
                  onCheckedChange={(on) => updateField("pos.allowSellerSales", on)}
                />
              </SettingList>
              {nobody ? <WarningBanner>{t("accessNone")}</WarningBanner> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("checkout")}</CardTitle>
              <CardDescription>{t("checkoutDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="@container">
                {/* Hairlines are the grid's own background showing through the gaps. */}
                <div className="bg-border grid gap-px overflow-hidden rounded-lg border @2xl:grid-cols-2">
                  {paymentOptions.map((option) => {
                    const on = methods.includes(option.method);
                    return (
                      <div key={option.method} className="bg-card">
                        <FeatureRow
                          icon={option.icon}
                          title={option.name}
                          description={option.note}
                          checked={on}
                          // One way to pay stays on: with none, the register
                          // could not take a sale.
                          disabled={on && methods.length === 1}
                          onCheckedChange={(next) => setMethod(option.method, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* It used to refuse the last switch without a word. */}
              {methods.length <= 1 ? (
                <p className="text-muted-foreground text-sm">{t("paymentLast")}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("register")}</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingList>
                <DefaultCounterRow
                  locations={props.locations}
                  value={pos.defaultPosLocationId || ""}
                  onChange={(locationId) =>
                    updateField("pos.defaultPosLocationId", locationId)
                  }
                />

                <SettingRow
                  inputId="posOrderNumberPrefix"
                  label={t("orderNumberPrefix")}
                  hint={t.rich("orderNumberPrefixExample", {
                    example: `${prefix || "POS"}${EXAMPLE_ORDER_SEQUENCE}`,
                    strong: (chunks) => (
                      <strong className="text-foreground font-medium">{chunks}</strong>
                    ),
                  })}
                >
                  {/* Left empty, the register numbers with POS (the placeholder). */}
                  <Input
                    id="posOrderNumberPrefix"
                    className="w-28 uppercase"
                    value={prefix}
                    onChange={(event) =>
                      updateField(
                        "pos.orders.orderNumberPrefix",
                        event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                      )
                    }
                    placeholder="POS"
                    maxLength={10}
                  />
                </SettingRow>

                <SettingSwitchItem
                  title={t("printedReceipts")}
                  description={t("printedReceiptsDesc")}
                  checked={printing}
                  onCheckedChange={(on) =>
                    updateField("pos.customize.printedReceiptsEnabled", on)
                  }
                />
                {printing ? (
                  <SettingRow
                    inputId="posReceiptPrinter"
                    label={t("receiptPrinter")}
                    hint={t("receiptPrinterHint")}
                    className="bg-muted/30"
                  >
                    <Input
                      id="posReceiptPrinter"
                      value={customize?.receiptPrinter || ""}
                      onChange={(event) =>
                        updateField("pos.customize.receiptPrinter", event.target.value)
                      }
                      placeholder={t("receiptPrinterPlaceholder")}
                    />
                  </SettingRow>
                ) : null}
              </SettingList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("sound")}</CardTitle>
              <CardDescription>{t("soundDesc")}</CardDescription>
              <CardAction>
                <Switch
                  checked={soundOn}
                  aria-label={t("sound")}
                  onCheckedChange={(on) => updateField("pos.customize.soundEnabled", on)}
                />
              </CardAction>
            </CardHeader>
            {soundOn ? (
              <CardContent>
                <div className="@container">
                  <div className="bg-border grid gap-px overflow-hidden rounded-lg border @lg:grid-cols-2">
                    <div className="bg-card flex flex-col gap-3 p-4 @xl:flex-row @xl:items-center @xl:gap-6 @lg:col-span-2">
                      <p className="min-w-0 flex-1 text-sm font-medium">
                        {t("soundVolume")}
                      </p>
                      <div className="flex shrink-0 items-center gap-3 @xl:w-72">
                        <Slider
                          aria-label={t("soundVolume")}
                          className="flex-1"
                          value={[volume]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={([next]) =>
                            updateField("pos.customize.soundVolume", next)
                          }
                        />
                        <span className="text-muted-foreground w-12 text-end text-sm tabular-nums">
                          {new Intl.NumberFormat(locale, { style: "percent" }).format(
                            volume / 100,
                          )}
                        </span>
                      </div>
                    </div>
                    {sounds.map((sound) => {
                      const on = customize?.[sound.key] !== false;
                      return (
                        <div
                          key={sound.key}
                          className="bg-card flex items-center gap-3 px-4"
                        >
                          {/* A muted chip like the icons of the cards above:
                              "secondary" is the store's brand colour here. */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground shrink-0"
                            aria-label={t("soundPlay", { sound: sound.name })}
                            disabled={!on}
                            onClick={() => previewPOSSound(sound.type, volume)}
                          >
                            <Play className="size-3.5" />
                          </Button>
                          <label className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3">
                            <span className="min-w-0 flex-1 text-sm font-medium">
                              {sound.name}
                            </span>
                            <Switch
                              checked={on}
                              aria-label={sound.name}
                              onCheckedChange={(next) =>
                                updateField(`pos.customize.${sound.key}`, next)
                              }
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            ) : null}
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
    </div>
  );
}

/**
 * The counter a register starts at, until its cashier picks their own.
 *
 * Only a place a register may stand at is offered: active, and selling over
 * a counter. The register accepts no other (lib/pos/resolve-location.ts), so
 * a warehouse picked here was dropped without a word and the register sold
 * from somewhere else. A saved counter that has stopped being one is named.
 */
function DefaultCounterRow(props: {
  locations: POSLocationList;
  /** The saved location id; empty for none. */
  value: string;
  onChange: (locationId: string) => void;
}) {
  const t = useTranslations("admin.settings.pos");
  const tCommon = useTranslations("common");
  const { locations, value } = props;

  const loaded = Array.isArray(locations) ? locations : null;
  const counters = (loaded ?? []).filter(
    (location) => location.isActive === true && location.sellsAtCounter !== false,
  );
  const saved = value ? loaded?.find((location) => location._id === value) : undefined;
  const gone =
    loaded !== null &&
    value !== "" &&
    !counters.some((location) => location._id === value);

  const locationsLink = linkTo("/admin/locations");

  const hint =
    locations === "failed" ? (
      <span className={cautionClass}>{t("locationsFailed")}</span>
    ) : gone ? (
      <span className={cautionClass}>
        {saved ? t("locationGone", { name: saved.name }) : t("locationMissing")}
      </span>
    ) : loaded !== null && counters.length === 0 ? (
      t.rich("locationsEmpty", { link: locationsLink })
    ) : (
      t.rich("defaultLocationHint", { link: locationsLink })
    );

  return (
    <SettingRow inputId="posDefaultCounter" label={t("defaultLocation")} hint={hint}>
      <Select
        // Empty shows the placeholder: while the list loads, and for a saved
        // counter that is no longer one.
        value={loaded !== null && !gone ? value || NO_COUNTER : ""}
        onValueChange={(next) => props.onChange(next === NO_COUNTER ? "" : next)}
        disabled={loaded === null}
      >
        <SelectTrigger id="posDefaultCounter" className="w-full">
          <SelectValue
            placeholder={locations === null ? tCommon("loading") : t("selectLocation")}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_COUNTER}>{t("noLocation")}</SelectItem>
          {counters.map((location) => (
            <SelectItem key={location._id} value={location._id}>
              <span className="truncate">{location.name}</span>
              {location.isDefault ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {t("defaultBadge")}
                </Badge>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
