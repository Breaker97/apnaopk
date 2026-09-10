"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Power,
  ShieldCheck,
  Globe,
  LayoutGrid,
  CreditCard,
  RotateCcw,
  Banknote,
  FileText,
  MapPin,
  Monitor,
  Printer,
  Users,
  Receipt,
  WifiOff,
  Volume2,
  ShoppingCart,
  CircleCheckBig,
  AlertCircle,
  Play,
  Building2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Slider } from "@/components/ui/slider";
import type { Settings } from "@/components/admin/settings/types";
import { previewPOSSound } from "@/lib/pos/pos-sounds";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

// ============================================
// Types
// ============================================

interface POSSettingsTabProps {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}

interface LocationOption {
  _id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "bn", name: "Bengali" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "de", name: "German" },
];

// ============================================
// Section Card Component
// ============================================

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {badge}
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
    </div>
  );
}

// ============================================
// Toggle Row Component
// ============================================

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function POSSettingsTab(props: POSSettingsTabProps) {
  const t = useTranslations();
  const pos = props.settings.pos;
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const posOrderNumberPrefixLabel = t.has(
    "admin.settings.pos.orderNumberPrefix"
  )
    ? t("admin.settings.pos.orderNumberPrefix")
    : "Order number prefix";
  const posOrderNumberPrefixHint = t.has(
    "admin.settings.pos.orderNumberPrefixHint"
  )
    ? t("admin.settings.pos.orderNumberPrefixHint")
    : "New POS orders use this prefix with a six-digit number, for example POS000017.";

  // Fetch locations for the dropdown
  useEffect(() => {
    async function fetchLocations() {
      setLoadingLocations(true);
      try {
        const res = await fetch("/api/admin/locations?includeInactive=true");
        const json = await res.json();
        if (json.success) {
          setLocations(json.data);
        }
      } catch {
        // silent
      } finally {
        setLoadingLocations(false);
      }
    }
    fetchLocations();
  }, []);

  const paymentMethods: ("cash" | "card" | "manual" | "bank")[] =
    pos.checkout?.paymentMethods ?? ["cash", "card"];

  const togglePaymentMethod = (
    method: "cash" | "card" | "manual" | "bank",
    checked: boolean
  ) => {
    const current = [...paymentMethods];
    if (checked && !current.includes(method)) {
      current.push(method);
    } else if (!checked) {
      const filtered = current.filter((m) => m !== method);
      if (filtered.length === 0) return; // keep at least one
      props.updateField("pos.checkout.paymentMethods", filtered);
      return;
    }
    props.updateField("pos.checkout.paymentMethods", current);
  };

  const paymentMethodOptions = [
    {
      value: "cash" as const,
      label: t("admin.settings.pos.paymentCash"),
      description: t("admin.settings.pos.paymentCashDesc"),
      icon: Banknote,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-100 dark:bg-green-900/40",
    },
    {
      value: "card" as const,
      label: t("admin.settings.pos.paymentCard"),
      description: t("admin.settings.pos.paymentCardDesc"),
      icon: CreditCard,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-900/40",
    },
    {
      value: "manual" as const,
      label: t("admin.settings.pos.paymentManual"),
      description: t("admin.settings.pos.paymentManualDesc"),
      icon: FileText,
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-100 dark:bg-orange-900/40",
    },
    {
      value: "bank" as const,
      label: t("admin.settings.pos.paymentBank"),
      description: t("admin.settings.pos.paymentBankDesc"),
      icon: Building2,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-100 dark:bg-amber-900/40",
    },
  ];

  return (
    <div className="relative">
      <div className="space-y-6">
        <SettingsTabHeader
          title={t("admin.settings.pos.title")}
          description={t("admin.settings.pos.description")}
        />

        {/* Section 1: Enable POS */}
        <SectionCard
          icon={Power}
          title={t("admin.settings.pos.enable")}
          description={t("admin.settings.pos.enableDesc")}
          badge={
            pos.enabled ? (
              <Badge
                variant="default"
                className="text-[10px] px-1.5 py-0 bg-green-600"
              >
                {t("admin.settings.pos.enabled")}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {t("admin.settings.pos.disabled")}
              </Badge>
            )
          }
        >
          <ToggleRow
            icon={Monitor}
            label={t("admin.settings.pos.enable")}
            description={t("admin.settings.pos.enableDesc")}
            checked={Boolean(pos.enabled)}
            onChange={(v) => props.updateField("pos.enabled", v)}
          />
        </SectionCard>

        {/* Section 2: Role Access */}
        <SectionCard
          icon={ShieldCheck}
          title={t("admin.settings.pos.access")}
          description={t("admin.settings.pos.accessDesc")}
        >
          <div className="space-y-2">
            <ToggleRow
              icon={ShieldCheck}
              label={t("admin.settings.pos.admin")}
              description={t("admin.settings.pos.adminDesc")}
              checked={Boolean(pos.allowAdminSales)}
              onChange={(v) => props.updateField("pos.allowAdminSales", v)}
              disabled={!pos.enabled}
            />
            <ToggleRow
              icon={Users}
              label={t("admin.settings.pos.vendor")}
              description={t("admin.settings.pos.vendorDesc")}
              checked={Boolean(pos.allowVendorSales)}
              onChange={(v) => props.updateField("pos.allowVendorSales", v)}
              disabled={!pos.enabled}
            />
            <ToggleRow
              icon={Users}
              label={t("admin.settings.pos.seller")}
              description={t("admin.settings.pos.sellerDesc")}
              checked={Boolean(pos.allowSellerSales)}
              onChange={(v) => props.updateField("pos.allowSellerSales", v)}
              disabled={!pos.enabled}
            />
          </div>
        </SectionCard>

        {/* Section 3: General Settings */}
        <SectionCard
          icon={Globe}
          title={t("admin.settings.pos.general")}
          description={t("admin.settings.pos.generalDesc")}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="posLanguage">
                {t("admin.settings.pos.language")}
              </Label>
              <SearchableSelect
                id="posLanguage"
                value={pos.language || "en"}
                onValueChange={(v) => props.updateField("pos.language", v)}
                disabled={!pos.enabled}
                options={LANGUAGE_OPTIONS.map((lang) => ({
                  value: lang.code,
                  label: lang.name,
                }))}
                searchPlaceholder="Search language..."
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.pos.languageHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="posDefaultLocation">
                {t("admin.settings.pos.defaultLocation")}
              </Label>
              {loadingLocations ? (
                <div className="flex items-center gap-2 h-9 px-3 text-sm text-muted-foreground border rounded-md">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("common.loading")}...
                </div>
              ) : locations.length > 0 ? (
                <Select
                  value={pos.defaultPosLocationId || "none"}
                  onValueChange={(v) =>
                    props.updateField(
                      "pos.defaultPosLocationId",
                      v === "none" ? "" : v
                    )
                  }
                  disabled={!pos.enabled}
                >
                  <SelectTrigger id="posDefaultLocation">
                    <SelectValue
                      placeholder={t(
                        "admin.settings.pos.selectLocation"
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("admin.settings.pos.noLocation")}
                    </SelectItem>
                    {locations
                      .filter((loc) => loc.isActive)
                      .map((loc) => (
                        <SelectItem key={loc._id} value={loc._id}>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{loc.name}</span>
                            {loc.isDefault && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1 py-0"
                              >
                                {t("admin.settings.pos.defaultBadge")}
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="posDefaultLocation"
                  placeholder={t("admin.settings.pos.locationIdPlaceholder")}
                  value={pos.defaultPosLocationId || ""}
                  onChange={(e) =>
                    props.updateField(
                      "pos.defaultPosLocationId",
                      e.target.value
                    )
                  }
                  disabled={!pos.enabled}
                />
              )}
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.pos.defaultLocationHint")}
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Section 4: Payment Methods */}
        <SectionCard
          icon={CreditCard}
          title={t("admin.settings.pos.checkout")}
          description={t("admin.settings.pos.checkoutDesc")}
        >
          <div className="space-y-5">
            <div>
              <Label className="mb-3 block">
                {t("admin.settings.pos.paymentMethods")}
              </Label>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {paymentMethodOptions.map((method) => {
                  const isChecked = paymentMethods.includes(method.value);
                  const MethodIcon = method.icon;
                  return (
                    <label
                      key={method.value}
                      className={`relative flex min-h-[112px] cursor-pointer flex-col rounded-md border p-3 pr-9 text-sm transition-colors hover:bg-muted/40 ${
                        isChecked
                          ? "border-primary/35 bg-primary/[0.04]"
                          : "border-border"
                      } ${!pos.enabled ? "opacity-50 pointer-events-none" : ""}`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) =>
                          togglePaymentMethod(method.value, Boolean(v))
                        }
                        disabled={!pos.enabled}
                        className="absolute right-3 top-3"
                      />
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${method.bg}`}
                        >
                          <MethodIcon className={`h-4 w-4 ${method.color}`} />
                        </span>
                        <span className="min-w-0 space-y-1">
                          <span className="block text-sm font-medium leading-snug">
                            {method.label}
                          </span>
                          <span className="block text-xs leading-snug text-muted-foreground">
                            {method.description}
                          </span>
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <ToggleRow
                icon={WifiOff}
                label={t("admin.settings.pos.offlinePayments")}
                description={t("admin.settings.pos.offlinePaymentsDesc")}
                checked={Boolean(pos.checkout?.offlinePaymentsEnabled)}
                onChange={(v) =>
                  props.updateField("pos.checkout.offlinePaymentsEnabled", v)
                }
                disabled={!pos.enabled}
              />
            </div>
          </div>
        </SectionCard>

        {/* Section 5: Customize */}
        <SectionCard
          icon={LayoutGrid}
          title={t("admin.settings.pos.customize")}
          description={t("admin.settings.pos.customizeDesc")}
        >
          <div className="space-y-2">
            <ToggleRow
              icon={Printer}
              label={t("admin.settings.pos.printedReceipts")}
              description={t("admin.settings.pos.printedReceiptsDesc")}
              checked={Boolean(pos.customize?.printedReceiptsEnabled)}
              onChange={(v) =>
                props.updateField("pos.customize.printedReceiptsEnabled", v)
              }
              disabled={!pos.enabled}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {pos.customize?.printedReceiptsEnabled && (
              <div className="space-y-2">
                <Label htmlFor="receiptPrinter" className="flex items-center gap-2">
                  <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("admin.settings.pos.receiptPrinter")}
                </Label>
                <Input
                  id="receiptPrinter"
                  placeholder={t(
                    "admin.settings.pos.receiptPrinterPlaceholder"
                  )}
                  value={pos.customize?.receiptPrinter || ""}
                  onChange={(e) =>
                    props.updateField(
                      "pos.customize.receiptPrinter",
                      e.target.value
                    )
                  }
                  disabled={!pos.enabled}
                />
              </div>
            )}
          </div>
        </SectionCard>

        {/* Section 6: Sound Effects */}
        <SectionCard
          icon={Volume2}
          title={t("admin.settings.pos.sound")}
          description={t("admin.settings.pos.soundDesc")}
          badge={
            pos.customize?.soundEnabled !== false ? (
              <Badge
                variant="default"
                className="text-[10px] px-1.5 py-0 bg-green-600"
              >
                {t("admin.settings.pos.enabled")}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {t("admin.settings.pos.disabled")}
              </Badge>
            )
          }
        >
          <ToggleRow
            icon={Volume2}
            label={t("admin.settings.pos.soundEnable")}
            description={t("admin.settings.pos.soundEnableDesc")}
            checked={pos.customize?.soundEnabled !== false}
            onChange={(v) =>
              props.updateField("pos.customize.soundEnabled", v)
            }
            disabled={!pos.enabled}
          />

          {pos.customize?.soundEnabled !== false && (
            <div className="space-y-5 animate-in fade-in slide-in-from-top-1 duration-200">
              {/* Volume Slider */}
              <div className="space-y-3 rounded-lg border px-4 py-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <Volume2 className="h-4 w-4 text-muted-foreground" />
                    {t("admin.settings.pos.soundVolume")}
                  </Label>
                  <span className="text-sm font-mono tabular-nums text-muted-foreground">
                    {pos.customize?.soundVolume ?? 50}%
                  </span>
                </div>
                <Slider
                  value={[pos.customize?.soundVolume ?? 50]}
                  onValueChange={([v]) =>
                    props.updateField("pos.customize.soundVolume", v)
                  }
                  min={0}
                  max={100}
                  step={5}
                  disabled={!pos.enabled}
                  className="w-full"
                />
              </div>

              {/* Individual Sound Toggles */}
              <div className="space-y-2">
                {(
                  [
                    {
                      key: "soundAddToCart" as const,
                      soundType: "addToCart" as const,
                      icon: ShoppingCart,
                      label: t("admin.settings.pos.soundAddToCart"),
                      desc: t("admin.settings.pos.soundAddToCartDesc"),
                    },
                    {
                      key: "soundPayment" as const,
                      soundType: "payment" as const,
                      icon: CreditCard,
                      label: t("admin.settings.pos.soundPayment"),
                      desc: t("admin.settings.pos.soundPaymentDesc"),
                    },
                    {
                      key: "soundOrderComplete" as const,
                      soundType: "orderComplete" as const,
                      icon: CircleCheckBig,
                      label: t("admin.settings.pos.soundOrderComplete"),
                      desc: t("admin.settings.pos.soundOrderCompleteDesc"),
                    },
                    {
                      key: "soundError" as const,
                      soundType: "error" as const,
                      icon: AlertCircle,
                      label: t("admin.settings.pos.soundError"),
                      desc: t("admin.settings.pos.soundErrorDesc"),
                    },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={
                          !pos.enabled ||
                          !pos.customize?.[item.key]
                        }
                        onClick={() =>
                          previewPOSSound(
                            item.soundType,
                            pos.customize?.soundVolume ?? 50
                          )
                        }
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Switch
                      checked={pos.customize?.[item.key] !== false}
                      onCheckedChange={(v) =>
                        props.updateField(`pos.customize.${item.key}`, v)
                      }
                      disabled={!pos.enabled}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Section 7: Orders */}
        <SectionCard
          icon={RotateCcw}
          title={t("admin.settings.pos.orders")}
          description={t("admin.settings.pos.ordersDesc")}
        >
          <div className="space-y-2">
            <Label htmlFor="posOrderNumberPrefix" className="flex items-center gap-2">
              <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
              {posOrderNumberPrefixLabel}
            </Label>
            <Input
              id="posOrderNumberPrefix"
              value={pos.orders?.orderNumberPrefix || "POS"}
              onChange={(e) =>
                props.updateField(
                  "pos.orders.orderNumberPrefix",
                  e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                )
              }
              placeholder="POS"
              disabled={!pos.enabled}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              {posOrderNumberPrefixHint}
            </p>
          </div>

        </SectionCard>
      </div>

      <StickySaveFooter
        label={t("admin.settings.pos.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={props.onSave}
      />
    </div>
  );
}
