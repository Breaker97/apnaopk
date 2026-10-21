"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { ColorSwatchPicker } from "@/components/admin/color-swatch-picker";
import {
  ADMIN_STORE_BUILDER_SCOPE,
  StoreBuilderScopeProvider,
  VENDOR_STORE_BUILDER_SCOPE,
} from "@/components/admin/store-pages/builder-scope";
import { CouponSelect } from "@/components/admin/store-pages/coupon-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { WarningBanner } from "@/components/ui/warning-banner";
import { useRouter } from "@/hooks/use-locale-navigation";
import { ApiClientError, apiClient, describeApiError } from "@/lib/api/client";
import {
  CAMPAIGN_BANNER_DEVICES,
  CAMPAIGN_BANNER_IMAGE_SCALE,
  MAX_FREQUENCY_DAYS,
  MAX_TRIGGER_SECONDS,
  campaignBannerLinkProblem,
  campaignBannerProblemCode,
  campaignBannerState,
  defaultCampaignBannerFields,
  normalizeCampaignBannerFields,
  type CampaignBanner,
  type CampaignBannerContent,
  type CampaignBannerContentMode,
  type CampaignBannerFields,
  type CampaignBannerProblemCode,
  type CampaignBannerType,
} from "@/lib/campaign-banners/types";
import { cn } from "@/lib/utils";
import { CampaignBannerImageField } from "./campaign-banner-image-field";
import { CampaignBannerPreview } from "./campaign-banner-preview";
import {
  editBannerHref,
  type CampaignBannerScope,
} from "./campaign-banner-scope";

/**
 * The editor's `<form>` wraps the fields only, and the Save button in the
 * sticky header points at it by id. The preview is outside it on purpose: it
 * shows the signup box, which is a `<form>` of its own, and a form inside a
 * form is invalid HTML — pressing Enter in the preview's email box submitted
 * the page natively and wiped the editor.
 */
const FORM_ID = "campaign-banner-form";

type TriggerKind = CampaignBannerFields["rules"]["trigger"]["kind"];
type FrequencyKind = CampaignBannerFields["rules"]["frequency"]["kind"];

/**
 * The field each save problem is about. A refused save says so in a toast, and
 * also puts the message under that field and moves focus there: the Save
 * button sits in the sticky header, so the field may be a screen away.
 */
const PROBLEM_FIELD: Record<CampaignBannerProblemCode, string> = {
  name: "cb-name",
  needsContent: "cb-headline",
  needsImage: "cb-image-desktop",
  ctaNeedsLink: "cb-cta-href",
  linkInvalid: "cb-cta-href",
  linkVendor: "cb-cta-href",
  countdownNeedsEnd: "cb-countdown-ends",
  endBeforeStart: "cb-end",
};

function focusField(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
}

/** Stored UTC instant → the value a `datetime-local` input shows, in the viewer's zone. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value (read as the viewer's local time) → a UTC instant. */
function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** "Asia/Dhaka (GMT+6)", for the label beside a date. Browser-only. */
function zoneLabel(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = -new Date().getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hours = Math.floor(Math.abs(offset) / 60);
    const minutes = Math.abs(offset) % 60;
    return `${zone} (GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""})`;
  } catch {
    return "";
  }
}

/**
 * A whole number in a box, on the app's shared NumberInput (which keeps what
 * is typed until it is valid). Clearing the box holds the last value rather
 * than writing a number the editor never typed.
 */
function WholeNumberInput({
  value,
  onChange,
  ...props
}: Omit<
  ComponentProps<typeof NumberInput>,
  "value" | "onValueChange" | "whenEmpty" | "normalize"
> & {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberInput
      {...props}
      inputMode="numeric"
      value={value}
      whenEmpty="keep"
      normalize={Math.round}
      onValueChange={(next) => {
        if (next !== undefined) onChange(next);
      }}
    />
  );
}

/** A short closed list, drawn like every other dropdown in the admin. */
function OptionSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  className,
}: {
  id?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** Why the last save was refused, when it was this field's doing. */
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** An on/off setting: the bordered row the product form uses for its switches. */
function SwitchRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label htmlFor={id} className="leading-5">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/**
 * One colour, through the admin's own picker (never the browser's native
 * colour box). Empty means the theme's colour, and says so.
 */
function ColorField({
  label,
  value,
  onChange,
  disabled,
  clearLabel,
  themeLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  clearLabel: string;
  themeLabel: string;
}) {
  return (
    <Field label={label}>
      <div className="flex min-h-9 items-center gap-2">
        <ColorSwatchPicker
          value={value}
          onChange={onChange}
          ariaLabel={label}
          disabled={disabled}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            !value && "text-muted-foreground",
          )}
        >
          {value || themeLabel}
        </span>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange("")}
          >
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

const EMPTY: CampaignBannerFields = defaultCampaignBannerFields("popup");

/** The editable part of a banner as the API returns it. */
function fieldsOf(banner: CampaignBanner): CampaignBannerFields {
  return normalizeCampaignBannerFields(banner, banner.vendorId ? "vendor" : "platform");
}

/**
 * Create or edit one Campaign Banner. The same form serves the admin, the
 * staff area and a vendor's dashboard; the scope says where it saves and
 * whether it can (read-only shows every field disabled).
 */
export function CampaignBannerForm({
  scope,
  bannerId,
  themeRadius = null,
}: {
  scope: CampaignBannerScope;
  bannerId?: string;
  /** The store theme's card radius in px, for the preview's corners. */
  themeRadius?: number | null;
}) {
  const t = useTranslations("admin.campaignBanners");
  const router = useRouter();
  const readOnly = !scope.canEdit;

  const [fields, setFields] = useState<CampaignBannerFields>(EMPTY);
  const [loading, setLoading] = useState(Boolean(bannerId));
  // Why an existing banner could not be opened (gone, or not this owner's).
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  // The last refused save and the fields it was refused for: it shows only
  // while those are still what is in the form, so editing anything clears it.
  const [refusal, setRefusal] = useState<{
    code: CampaignBannerProblemCode;
    fields: CampaignBannerFields;
  } | null>(null);
  // Resolved after mount: the zone is the browser's, which the server cannot know.
  const [zone, setZone] = useState("");
  const [now] = useState(() => new Date());

  useEffect(() => setZone(zoneLabel()), []);

  useEffect(() => {
    if (!bannerId) return;
    let cancelled = false;
    apiClient
      .get<CampaignBanner>(`${scope.apiBase}/${bannerId}`)
      .then((banner) => {
        if (!cancelled) setFields(fieldsOf(banner));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError && error.status === 404
            ? t("notFound")
            : describeApiError(error, t("toast.loadFailed")),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bannerId, scope.apiBase, t]);

  const patch = useCallback(
    (next: Partial<CampaignBannerFields>) =>
      setFields((current) => ({ ...current, ...next })),
    [],
  );
  const patchContent = useCallback(
    (next: Partial<CampaignBannerContent>) =>
      setFields((current) => ({
        ...current,
        content: { ...current.content, ...next },
      })),
    [],
  );

  const changeType = (type: CampaignBannerType) =>
    setFields((current) => ({
      ...current,
      type,
      rules: {
        ...current.rules,
        trigger: {
          ...current.rules.trigger,
          kind:
            current.rules.trigger.kind === "immediate" || current.rules.trigger.kind === "delay"
              ? type === "bar"
                ? "immediate"
                : "delay"
              : current.rules.trigger.kind,
        },
      },
      signup: type === "bar" ? { ...current.signup, enabled: false } : current.signup,
    }));

  async function save() {
    const owner = scope.vendor ? "vendor" : "platform";
    const normalized = normalizeCampaignBannerFields(fields, owner);
    // The typed link first: normalizing blanks a bad one, and a blank link
    // would be reported as "a button needs a link".
    const problem =
      campaignBannerLinkProblem(fields.content, owner) ??
      campaignBannerProblemCode(normalized);
    if (problem) {
      toast.error(t(`form.problems.${problem}`));
      setRefusal({ code: problem, fields });
      focusField(PROBLEM_FIELD[problem]);
      return;
    }
    setSaving(true);
    try {
      if (bannerId) {
        const saved = await apiClient.put<CampaignBanner>(
          `${scope.apiBase}/${bannerId}`,
          normalized,
        );
        setFields(fieldsOf(saved));
        toast.success(t("toast.saved"));
      } else {
        const created = await apiClient.post<CampaignBanner>(
          scope.apiBase,
          normalized,
        );
        toast.success(t("toast.created"));
        router.push(editBannerHref(scope, created.id));
      }
    } catch (error) {
      toast.error(describeApiError(error, t("toast.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24" role="status" aria-label={t("loading")}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button type="button" variant="outline" onClick={() => router.push(scope.basePath)}>
          <ArrowLeft className="h-4 w-4" />
          {t("actions.back")}
        </Button>
      </div>
    );
  }

  const state = campaignBannerState(fields, now);
  const { content, rules, signup, countdown } = fields;
  const isBar = fields.type === "bar";
  const mobileImmediatePopup =
    !isBar &&
    rules.devices.includes("mobile") &&
    rules.trigger.kind === "immediate";

  const refusedField =
    refusal && refusal.fields === fields ? PROBLEM_FIELD[refusal.code] : null;
  /** The refusal's message, when it is about the field with this id. */
  const errorFor = (id: string) =>
    refusal && refusedField === id ? t(`form.problems.${refusal.code}`) : undefined;
  const invalid = (id: string) => (errorFor(id) ? true : undefined);

  const statusOptions: { value: CampaignBannerFields["status"]; label: string }[] = [
    { value: "draft", label: t("statusOption.draft") },
    { value: "active", label: t("statusOption.active") },
    { value: "paused", label: t("statusOption.paused") },
  ];
  const triggerOptions: { value: TriggerKind; label: string }[] = [
    { value: "immediate", label: t("form.trigger.immediate") },
    { value: "delay", label: t("form.trigger.delay") },
    { value: "scroll", label: t("form.trigger.scroll") },
  ];
  const frequencyOptions: { value: FrequencyKind; label: string }[] = [
    { value: "session", label: t("form.frequency.session") },
    { value: "days", label: t("form.frequency.days") },
  ];
  const barPositionOptions: {
    value: CampaignBannerContent["barPosition"];
    label: string;
  }[] = [
    { value: "top", label: t("form.barPosition.top") },
    { value: "bottom", label: t("form.barPosition.bottom") },
  ];

  // The Content card's pieces. A popup picks its tab; a bar has no pictures and
  // goes straight to the text. The picture is on both tabs (one picture, two
  // ways to use it); its size only matters when the picture stands alone.
  const hasImage = Boolean(content.imageDesktop || content.imageMobile);
  /** The "Only image content" tab: the popup is the picture and nothing else. */
  const imageOnly = !isBar && content.mode === "image";

  const imagePickers = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("form.fields.imageDesktop")} error={errorFor("cb-image-desktop")}>
        {/* A refused save for a missing picture moves focus here. */}
        <div id="cb-image-desktop" tabIndex={-1} className="outline-none">
          <CampaignBannerImageField
            value={content.imageDesktop}
            onChange={(imageDesktop) => patchContent({ imageDesktop })}
            disabled={readOnly}
            title={t("form.upload.title")}
            description={t("form.upload.desktop")}
          />
        </div>
      </Field>
      <Field label={t("form.fields.imageMobile")} hint={t("form.hints.imageMobile")}>
        <CampaignBannerImageField
          value={content.imageMobile}
          onChange={(imageMobile) => patchContent({ imageMobile })}
          disabled={readOnly}
          title={t("form.upload.title")}
          description={t("form.upload.mobile")}
        />
      </Field>
    </div>
  );

  const imageAltField = hasImage ? (
    <Field label={t("form.fields.imageAlt")} htmlFor="cb-alt">
      <Input
        id="cb-alt"
        value={content.imageAlt}
        maxLength={200}
        onChange={(event) => patchContent({ imageAlt: event.target.value })}
      />
    </Field>
  ) : null;

  const imageScaleField = hasImage ? (
    <Field
      label={t("form.fields.imageScale")}
      hint={t("form.hints.imageScale")}
      htmlFor="cb-image-scale"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Slider
          className="min-w-40 flex-1"
          aria-label={t("form.fields.imageScale")}
          min={CAMPAIGN_BANNER_IMAGE_SCALE.min}
          max={CAMPAIGN_BANNER_IMAGE_SCALE.max}
          step={5}
          value={[content.imageScale]}
          disabled={readOnly}
          onValueChange={([imageScale]) => patchContent({ imageScale })}
        />
        <div className="flex items-center gap-1.5">
          <WholeNumberInput
            id="cb-image-scale"
            className="w-24"
            value={content.imageScale}
            min={CAMPAIGN_BANNER_IMAGE_SCALE.min}
            max={CAMPAIGN_BANNER_IMAGE_SCALE.max}
            onChange={(imageScale) => patchContent({ imageScale })}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
        {content.imageScale !== CAMPAIGN_BANNER_IMAGE_SCALE.default ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={readOnly}
            onClick={() =>
              patchContent({ imageScale: CAMPAIGN_BANNER_IMAGE_SCALE.default })
            }
          >
            {t("form.actions.resetImageScale")}
          </Button>
        ) : null}
      </div>
    </Field>
  ) : null;

  const copyFields = (
    <>
      <Field
        label={t("form.fields.headline")}
        error={errorFor("cb-headline")}
        htmlFor="cb-headline"
      >
        <Input
          id="cb-headline"
          value={content.headline}
          maxLength={120}
          placeholder={t("form.placeholders.headline")}
          aria-invalid={invalid("cb-headline")}
          onChange={(event) => patchContent({ headline: event.target.value })}
        />
      </Field>
      <Field label={t("form.fields.body")} htmlFor="cb-body">
        <Textarea
          id="cb-body"
          value={content.body}
          maxLength={400}
          rows={3}
          onChange={(event) => patchContent({ body: event.target.value })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("form.fields.ctaLabel")} htmlFor="cb-cta-label">
          <Input
            id="cb-cta-label"
            value={content.ctaLabel}
            maxLength={60}
            placeholder={t("form.placeholders.ctaLabel")}
            onChange={(event) => patchContent({ ctaLabel: event.target.value })}
          />
        </Field>
        <Field
          label={t("form.fields.ctaHref")}
          hint={scope.vendor ? t("form.hints.ctaHrefVendor") : t("form.hints.ctaHref")}
          error={errorFor("cb-cta-href")}
          htmlFor="cb-cta-href"
        >
          <Input
            id="cb-cta-href"
            value={content.ctaHref}
            maxLength={600}
            placeholder="/collections/sale"
            aria-invalid={invalid("cb-cta-href")}
            onChange={(event) => patchContent({ ctaHref: event.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField
          label={t("form.fields.backgroundColor")}
          value={content.backgroundColor}
          onChange={(backgroundColor) => patchContent({ backgroundColor })}
          disabled={readOnly}
          clearLabel={t("form.useTheme")}
          themeLabel={t("form.themeColour")}
        />
        <ColorField
          label={t("form.fields.textColor")}
          value={content.textColor}
          onChange={(textColor) => patchContent({ textColor })}
          disabled={readOnly}
          clearLabel={t("form.useTheme")}
          themeLabel={t("form.themeColour")}
        />
        <ColorField
          label={t("form.fields.buttonColor")}
          value={content.buttonColor}
          onChange={(buttonColor) => patchContent({ buttonColor })}
          disabled={readOnly}
          clearLabel={t("form.useTheme")}
          themeLabel={t("form.themeColour")}
        />
        <ColorField
          label={t("form.fields.buttonTextColor")}
          value={content.buttonTextColor}
          onChange={(buttonTextColor) => patchContent({ buttonTextColor })}
          disabled={readOnly}
          clearLabel={t("form.useTheme")}
          themeLabel={t("form.themeColour")}
        />
      </div>
    </>
  );

  const barPositionField = (
    <Field label={t("form.fields.barPosition")} htmlFor="cb-bar-position">
      <OptionSelect
        id="cb-bar-position"
        className="sm:w-64"
        value={content.barPosition}
        options={barPositionOptions}
        onChange={(barPosition) => patchContent({ barPosition })}
      />
    </Field>
  );

  return (
    <StoreBuilderScopeProvider
      value={scope.vendor ? VENDOR_STORE_BUILDER_SCOPE : ADMIN_STORE_BUILDER_SCOPE}
    >
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <AdminFormStickyHeader
          className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
          title={fields.name || (bannerId ? t("form.editTitle") : t("form.addTitle"))}
          status={
            <Badge variant={state === "live" ? "default" : "outline"}>
              {t(`state.${state}`)}
            </Badge>
          }
          actions={
            <>
              {readOnly ? null : (
                <Button type="submit" form={FORM_ID} size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {t("actions.save")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push(scope.basePath)}
                className="shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("actions.back")}
              </Button>
            </>
          }
        />

        {readOnly ? (
          <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {t("readOnly")}
          </p>
        ) : null}

        <div className="min-w-0">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <form
              id={FORM_ID}
              onSubmit={(event) => {
                event.preventDefault();
                if (!readOnly) void save();
              }}
              className="min-w-0 lg:col-span-3"
            >
              {/* Read-only disables the fields only: the preview's Desktop/Mobile toggle stays usable. */}
              <fieldset disabled={readOnly} className="min-w-0 space-y-4 border-0 p-0">
                {/* Basics */}
                <Card className="gap-2">
                  <CardHeader>
                    <CardTitle>{t("form.sections.basics")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Field
                      label={t("form.fields.name")}
                      hint={t("form.hints.name")}
                      error={errorFor("cb-name")}
                      htmlFor="cb-name"
                    >
                      <Input
                        id="cb-name"
                        value={fields.name}
                        maxLength={100}
                        placeholder={t("form.placeholders.name")}
                        aria-invalid={invalid("cb-name")}
                        onChange={(event) => patch({ name: event.target.value })}
                      />
                    </Field>

                    <Field label={t("form.fields.type")}>
                      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("form.fields.type")}>
                        {(["popup", "bar"] as const).map((type) => (
                          <button
                            key={type}
                            type="button"
                            role="radio"
                            aria-checked={fields.type === type}
                            disabled={readOnly}
                            onClick={() => changeType(type)}
                            className={cn(
                              "rounded-lg border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                              fields.type === type
                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                : "hover:bg-muted/50",
                            )}
                          >
                            <span className="block text-sm font-medium">{t(`type.${type}`)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {t(`form.typeHint.${type}`)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t("form.fields.status")} hint={t("form.hints.status")} htmlFor="cb-status">
                        <OptionSelect
                          id="cb-status"
                          value={fields.status}
                          options={statusOptions}
                          onChange={(status) => patch({ status })}
                        />
                      </Field>
                      <Field label={t("form.fields.priority")} hint={t("form.hints.priority")} htmlFor="cb-priority">
                        <WholeNumberInput
                          id="cb-priority"
                          value={fields.priority}
                          min={0}
                          max={100}
                          onChange={(priority) => patch({ priority })}
                        />
                      </Field>
                    </div>
                  </CardContent>
                </Card>

                {/* Content: a popup chooses between the two tabs */}
                <Card className="gap-2">
                  <CardHeader>
                    <CardTitle>{t("form.sections.content")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isBar ? (
                      <>
                        {copyFields}
                        {barPositionField}
                      </>
                    ) : (
                      <Tabs
                        value={content.mode}
                        onValueChange={(mode) =>
                          patchContent({ mode: mode as CampaignBannerContentMode })
                        }
                        className="gap-4"
                      >
                        <TabsList
                          aria-label={t("form.sections.content")}
                          className="grid h-auto w-full grid-cols-2"
                        >
                          <TabsTrigger value="image" className="whitespace-normal text-center">
                            {t("form.modes.image")}
                          </TabsTrigger>
                          <TabsTrigger value="content" className="whitespace-normal text-center">
                            {t("form.modes.content")}
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="image" className="space-y-4">
                          <p className="text-xs text-muted-foreground">{t("form.modeHints.image")}</p>
                          {imagePickers}
                          {imageAltField}
                          {imageScaleField}
                        </TabsContent>
                        <TabsContent value="content" className="space-y-4">
                          <p className="text-xs text-muted-foreground">{t("form.modeHints.content")}</p>
                          {imagePickers}
                          {imageAltField}
                          {copyFields}
                        </TabsContent>
                      </Tabs>
                    )}
                  </CardContent>
                </Card>

                {/* Offer: coupon + countdown. Not part of a picture-only popup. */}
                {!imageOnly ? (
                  <Card className="gap-2">
                    <CardHeader>
                      <CardTitle>{t("form.sections.offer")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Field label={t("form.fields.coupon")} hint={t("form.hints.coupon")}>
                        <CouponSelect
                          // A vendor's own discounts come from its builder scope; the
                          // store's banners get their own list (staff cannot read the
                          // Discounts one).
                          endpoint={scope.vendor ? undefined : `${scope.apiBase}/coupons`}
                          value={fields.couponCode}
                          onChange={(couponCode) => patch({ couponCode })}
                          ariaLabel={t("form.fields.coupon")}
                          placeholder={t("form.coupon.none")}
                          emptyLabel={t("form.coupon.empty")}
                        />
                      </Field>

                      <SwitchRow
                        id="cb-countdown"
                        label={t("form.fields.countdown")}
                        hint={t("form.hints.countdown")}
                        checked={countdown.enabled}
                        onCheckedChange={(enabled) =>
                          patch({ countdown: { ...countdown, enabled } })
                        }
                      />
                      {countdown.enabled ? (
                        <Field
                          label={t("form.fields.countdownEnds")}
                          hint={t("form.hints.countdownEnds")}
                          error={errorFor("cb-countdown-ends")}
                          htmlFor="cb-countdown-ends"
                        >
                          <Input
                            id="cb-countdown-ends"
                            type="datetime-local"
                            value={toLocalInput(countdown.endsAt)}
                            aria-invalid={invalid("cb-countdown-ends")}
                            onChange={(event) =>
                              patch({
                                countdown: {
                                  ...countdown,
                                  endsAt: fromLocalInput(event.target.value) ?? "",
                                },
                              })
                            }
                            className="sm:w-64"
                          />
                        </Field>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                {/* Signup: platform popups only */}
                {!scope.vendor && !isBar && !imageOnly ? (
                  <Card className="gap-2">
                    <CardHeader>
                      <CardTitle>{t("form.sections.signup")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <SwitchRow
                        id="cb-signup"
                        label={t("form.fields.signup")}
                        hint={t("form.hints.signup")}
                        checked={signup.enabled}
                        onCheckedChange={(enabled) =>
                          patch({ signup: { ...signup, enabled } })
                        }
                      />
                      {signup.enabled ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field
                            label={t("form.fields.signupPlaceholder")}
                            htmlFor="cb-signup-placeholder"
                          >
                            <Input
                              id="cb-signup-placeholder"
                              value={signup.placeholder}
                              maxLength={80}
                              onChange={(event) =>
                                patch({ signup: { ...signup, placeholder: event.target.value } })
                              }
                            />
                          </Field>
                          <Field
                            label={t("form.fields.signupButton")}
                            htmlFor="cb-signup-button"
                          >
                            <Input
                              id="cb-signup-button"
                              value={signup.buttonLabel}
                              maxLength={40}
                              onChange={(event) =>
                                patch({ signup: { ...signup, buttonLabel: event.target.value } })
                              }
                            />
                          </Field>
                          <div className="sm:col-span-2">
                            <Field
                              label={t("form.fields.signupConsent")}
                              hint={t("form.hints.signupConsent")}
                              htmlFor="cb-signup-consent"
                            >
                              <Textarea
                                id="cb-signup-consent"
                                rows={2}
                                maxLength={200}
                                value={signup.consentText}
                                onChange={(event) =>
                                  patch({ signup: { ...signup, consentText: event.target.value } })
                                }
                              />
                            </Field>
                          </div>
                          <Field
                            label={t("form.fields.signupSuccessTitle")}
                            htmlFor="cb-signup-success-title"
                          >
                            <Input
                              id="cb-signup-success-title"
                              value={signup.successHeadline}
                              maxLength={100}
                              onChange={(event) =>
                                patch({
                                  signup: { ...signup, successHeadline: event.target.value },
                                })
                              }
                            />
                          </Field>
                          <Field
                            label={t("form.fields.signupSuccessText")}
                            htmlFor="cb-signup-success-text"
                          >
                            <Input
                              id="cb-signup-success-text"
                              value={signup.successText}
                              maxLength={200}
                              onChange={(event) =>
                                patch({ signup: { ...signup, successText: event.target.value } })
                              }
                            />
                          </Field>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                {/* Display rules */}
                <Card className="gap-2">
                  <CardHeader>
                    <CardTitle>{t("form.sections.display")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Not a setting: banners only ever show on this one page. A badge, not a
                        read-only input, which looked like a box to type in. */}
                    <Field label={t("form.fields.page")}>
                      <div>
                        <Badge variant="secondary">
                          {scope.vendor ? t("form.page.vendor") : t("form.page.home")}
                        </Badge>
                      </div>
                    </Field>

                    <Field label={t("form.fields.devices")}>
                      <div
                        role="group"
                        aria-label={t("form.fields.devices")}
                        className="flex flex-wrap gap-4"
                      >
                        {CAMPAIGN_BANNER_DEVICES.map((device) => {
                          const checked = rules.devices.includes(device);
                          return (
                            <label key={device} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) => {
                                  const devices = next
                                    ? [...rules.devices, device]
                                    : rules.devices.filter((entry) => entry !== device);
                                  // Neither is not a choice: a banner for nobody.
                                  if (devices.length === 0) return;
                                  patch({ rules: { ...rules, devices } });
                                }}
                              />
                              {t(`devices.${device}`)}
                            </label>
                          );
                        })}
                      </div>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t("form.fields.trigger")} htmlFor="cb-trigger">
                        <div className="flex flex-wrap items-center gap-2">
                          <OptionSelect
                            id="cb-trigger"
                            className="min-w-40 flex-1"
                            value={rules.trigger.kind}
                            options={triggerOptions}
                            onChange={(kind) =>
                              patch({
                                rules: { ...rules, trigger: { ...rules.trigger, kind } },
                              })
                            }
                          />
                          {rules.trigger.kind === "delay" ? (
                            <div className="flex items-center gap-2">
                              <WholeNumberInput
                                className="w-24"
                                aria-label={t("form.fields.trigger")}
                                value={rules.trigger.seconds}
                                min={1}
                                max={MAX_TRIGGER_SECONDS}
                                onChange={(seconds) =>
                                  patch({
                                    rules: { ...rules, trigger: { ...rules.trigger, seconds } },
                                  })
                                }
                              />
                              <span className="text-sm text-muted-foreground">
                                {t("form.trigger.seconds")}
                              </span>
                            </div>
                          ) : null}
                          {rules.trigger.kind === "scroll" ? (
                            <div className="flex items-center gap-2">
                              <WholeNumberInput
                                className="w-24"
                                aria-label={t("form.fields.trigger")}
                                value={rules.trigger.percent}
                                min={5}
                                max={100}
                                onChange={(percent) =>
                                  patch({
                                    rules: { ...rules, trigger: { ...rules.trigger, percent } },
                                  })
                                }
                              />
                              <span className="text-sm text-muted-foreground">
                                {t("form.trigger.percent")}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </Field>

                      <Field label={t("form.fields.frequency")} htmlFor="cb-frequency">
                        <div className="flex flex-wrap items-center gap-2">
                          <OptionSelect
                            id="cb-frequency"
                            className="min-w-40 flex-1"
                            value={rules.frequency.kind}
                            options={frequencyOptions}
                            onChange={(kind) =>
                              patch({
                                rules: { ...rules, frequency: { ...rules.frequency, kind } },
                              })
                            }
                          />
                          {rules.frequency.kind === "days" ? (
                            <div className="flex items-center gap-2">
                              <WholeNumberInput
                                className="w-24"
                                aria-label={t("form.fields.frequency")}
                                value={rules.frequency.days}
                                min={1}
                                max={MAX_FREQUENCY_DAYS}
                                onChange={(days) =>
                                  patch({
                                    rules: { ...rules, frequency: { ...rules.frequency, days } },
                                  })
                                }
                              />
                              <span className="text-sm text-muted-foreground">
                                {t("form.frequency.daysUnit")}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </Field>
                    </div>

                    {mobileImmediatePopup ? (
                      <WarningBanner>{t("form.warnings.mobileImmediate")}</WarningBanner>
                    ) : null}
                  </CardContent>
                </Card>

                {/* Schedule */}
                <Card className="gap-2">
                  <CardHeader>
                    <CardTitle>{t("form.sections.schedule")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t("form.fields.start")} hint={t("form.hints.start")} htmlFor="cb-start">
                        <Input
                          id="cb-start"
                          type="datetime-local"
                          value={toLocalInput(fields.schedule.start)}
                          onChange={(event) =>
                            patch({
                              schedule: {
                                ...fields.schedule,
                                start: fromLocalInput(event.target.value),
                              },
                            })
                          }
                        />
                      </Field>
                      <Field
                        label={t("form.fields.end")}
                        hint={t("form.hints.end")}
                        error={errorFor("cb-end")}
                        htmlFor="cb-end"
                      >
                        <Input
                          id="cb-end"
                          type="datetime-local"
                          value={toLocalInput(fields.schedule.end)}
                          aria-invalid={invalid("cb-end")}
                          onChange={(event) =>
                            patch({
                              schedule: {
                                ...fields.schedule,
                                end: fromLocalInput(event.target.value),
                              },
                            })
                          }
                        />
                      </Field>
                    </div>
                    {zone ? (
                      <p className="text-xs text-muted-foreground">
                        {t("form.timezone", { zone })}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </fieldset>
            </form>

            <div className="lg:col-span-2">
              <div className="lg:sticky lg:top-[calc(var(--dashboard-header-height,4rem)+5rem)]">
                <Card className="gap-2">
                  <CardContent>
                    <CampaignBannerPreview fields={fields} themeRadius={themeRadius} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StoreBuilderScopeProvider>
  );
}
