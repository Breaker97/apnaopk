"use client";

import { useMemo, useState } from "react";
import type { Control } from "react-hook-form";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Store,
  FileText,
  Globe,
  Landmark,
  Building2,
  MapPin,
  Hash,
} from "lucide-react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { PhoneNumberField } from "@/components/ui/phone-number-field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DocumentUploadField } from "@/components/vendor/document-upload-field";
import { getAllowedCountryOptions } from "@/lib/intl/country-availability";
import { cn } from "@/lib/utils";
import type { ResolvedField } from "@/lib/vendors/vendor-onboarding";
import { useAppSettings } from "@/providers/app-settings-provider";

/** Left-aligned input icon for known system fields (cosmetic parity with the
 * original hardcoded wizard). Custom fields render without an icon. */
const FIELD_ICONS: Record<string, typeof User | undefined> = {
  name: User,
  email: Mail,
  password: Lock,
  confirmPassword: Lock,
  storeName: Store,
  description: FileText,
  city: Building2,
  address: MapPin,
  pincode: Hash,
  taxId: Hash,
};

interface OnboardingFieldProps {
  field: ResolvedField;
  control: Control<Record<string, unknown>>;
  /** Already-resolved display label (override → i18n → default). */
  label: string;
  placeholder?: string;
  helpText?: string | null;
  disabled?: boolean;
  /** Dependent state options for the `state` widget. */
  availableStates?: { label: string; value: string }[];
  /** Called after the `country` widget changes (parent resets state, etc.). */
  onCountryChange?: (value: string) => void;
  phoneCode?: string;
  onPhoneCodeChange?: (code: string) => void;
  /** Called after a document upload resolves, so the parent can persist it. */
  onDocumentUploaded?: () => void;
}

/**
 * Renders a single resolved onboarding field with the right widget. Purely
 * presentational: all data lives in the surrounding react-hook-form context, so
 * the same component drives both the storefront wizard and the admin builder's
 * live preview (with `disabled`).
 */
export function OnboardingField({
  field,
  control,
  label,
  placeholder,
  helpText,
  disabled,
  availableStates = [],
  onCountryChange,
  phoneCode = "+91",
  onPhoneCodeChange,
  onDocumentUploaded,
}: OnboardingFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const { countryAvailability } = useAppSettings();
  const availableCountries = useMemo(
    () => getAllowedCountryOptions(countryAvailability),
    [countryAvailability],
  );
  const Icon = FIELD_ICONS[field.key];
  const requiredMark = field.required ? (
    <span className="text-destructive"> *</span>
  ) : null;

  // Document upload manages its own label + layout, so it skips the FormLabel.
  if (field.widget === "document") {
    return (
      <FormField
        control={control}
        name={field.key}
        render={({ field: f }) => (
          <FormItem>
            <FormControl>
              <DocumentUploadField
                label={label + (field.required ? " *" : "")}
                hint={helpText || undefined}
                value={(f.value as string) || ""}
                disabled={disabled}
                onChange={(url) => {
                  f.onChange(url);
                  onDocumentUploaded?.();
                }}
              />
            </FormControl>
            <FormMessage className="text-xs" />
          </FormItem>
        )}
      />
    );
  }

  // Checkbox renders label inline to the right of the control.
  if (field.widget === "checkbox") {
    return (
      <FormField
        control={control}
        name={field.key}
        render={({ field: f }) => (
          <FormItem>
            <div className="flex items-start gap-2.5">
              <FormControl>
                <Checkbox
                  checked={Boolean(f.value)}
                  disabled={disabled}
                  onCheckedChange={(v) => f.onChange(v)}
                  className="mt-0.5"
                />
              </FormControl>
              <FormLabel className="text-sm font-medium text-foreground">
                {label}
                {requiredMark}
              </FormLabel>
            </div>
            {helpText ? (
              <p className="ml-6 mt-0.5 text-xs text-muted-foreground">
                {helpText}
              </p>
            ) : null}
            <FormMessage className="text-xs" />
          </FormItem>
        )}
      />
    );
  }

  return (
    <FormField
      control={control}
      name={field.key}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel className="text-sm font-medium text-foreground">
            {label}
            {requiredMark}
          </FormLabel>
          <FormControl>
            {field.widget === "textarea" ? (
              <div className="relative">
                {Icon ? (
                  <Icon className="pointer-events-none absolute left-3 top-[14px] h-4 w-4 text-muted-foreground" />
                ) : null}
                <Textarea
                  placeholder={placeholder}
                  disabled={disabled}
                  className={cn(
                    "min-h-[80px] py-2.5 resize-none",
                    Icon && "pl-10",
                  )}
                  {...f}
                  value={(f.value as string) ?? ""}
                />
              </div>
            ) : field.widget === "select" ? (
              <NativeSelect
                disabled={disabled}
                className="h-10 w-full"
                value={(f.value as string) ?? ""}
                onChange={(e) => f.onChange(e.target.value)}
              >
                <option value="">{placeholder || "Select…"}</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </NativeSelect>
            ) : field.widget === "phone" ? (
              <PhoneNumberField
                code={phoneCode}
                onCodeChange={(c) => onPhoneCodeChange?.(c)}
                disabled={disabled}
                {...f}
                value={(f.value as string) ?? ""}
              />
            ) : field.widget === "country" ? (
              <SearchableSelect
                options={availableCountries}
                value={(f.value as string) ?? ""}
                disabled={disabled}
                onValueChange={(value) => {
                  f.onChange(value);
                  onCountryChange?.(value);
                }}
                placeholder={placeholder || "Select country"}
                searchPlaceholder="Search country..."
                emptyText="No countries found"
                className="h-10"
                icon={
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                }
              />
            ) : field.widget === "state" ? (
              // Only countries with a region list (US, IN, …) get the dropdown;
              // every other country falls back to a free-text input so the field
              // is always usable (never a dead disabled select).
              availableStates.length === 0 ? (
                <div className="relative">
                  <Landmark className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={
                      // Ignore the select-oriented default ("Select state") for
                      // the text fallback; use the admin's own placeholder or a
                      // label-based one ("Enter district").
                      placeholder && placeholder !== "Select state"
                        ? placeholder
                        : `Enter ${label.toLowerCase()}`
                    }
                    disabled={disabled}
                    className="h-10 pl-10"
                    {...f}
                    value={(f.value as string) ?? ""}
                  />
                </div>
              ) : (
                <SearchableSelect
                  options={availableStates.filter((s) => s.value)}
                  value={(f.value as string) ?? ""}
                  disabled={disabled || availableStates.length === 0}
                  onValueChange={f.onChange}
                  placeholder={placeholder || "Select state"}
                  searchPlaceholder="Search state..."
                  emptyText="No states found"
                  className="h-10"
                  icon={
                    <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                  }
                />
              )
            ) : field.widget === "password" ? (
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder={placeholder}
                  disabled={disabled}
                  className="h-10 pl-10 pr-10"
                  {...f}
                  value={(f.value as string) ?? ""}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            ) : (
              <div className="relative">
                {Icon ? (
                  <Icon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                ) : null}
                <Input
                  type={field.widget === "email" ? "email" : "text"}
                  placeholder={placeholder}
                  disabled={disabled}
                  className={cn("h-10", Icon && "pl-10")}
                  {...f}
                  value={(f.value as string) ?? ""}
                />
              </div>
            )}
          </FormControl>
          {helpText ? (
            <p className="text-xs text-muted-foreground">{helpText}</p>
          ) : null}
          <FormMessage className="text-xs" />
        </FormItem>
      )}
    />
  );
}
