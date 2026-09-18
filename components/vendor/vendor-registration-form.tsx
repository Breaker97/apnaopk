"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useForm, type Resolver , useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Check,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { OnboardingField } from "@/components/vendor/onboarding/field-renderer";
import { buildOnboardingSchema } from "@/components/vendor/onboarding/onboarding-schema";
import { COUNTRIES, STATES } from "@/lib/intl/country-options";
import {
  COUNTRY_DIAL_CODES,
  composeInternationalPhone,
} from "@/lib/intl/phone-codes";
import { toast } from "@/components/ui/toast-notification";
import { authClient, signUp } from "@/lib/auth/auth-client";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { VENDOR_STATUS } from "@/config/app.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { ONBOARDING_STEP_KINDS } from "@/lib/vendors/vendor-onboarding-fields";
import { PricingPlanCard } from "@/components/vendor-plans/pricing-plan-card";
import { PlanGrid } from "@/components/vendor-plans/plan-grid";
import {
  PlanBillingToggle,
  type BillingView,
} from "@/components/vendor-plans/plan-billing-toggle";
import { planFeatureLines } from "@/components/vendor-plans/plan-feature-lines";
import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";
import { cn } from "@/lib/utils";
import type {
  OnboardingConfig,
  ResolvedField,
  ResolvedStep,
} from "@/lib/vendors/vendor-onboarding";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

// System field keys the wizard maps to Vendor.documents.* at submit/draft time.
const DOC_KEYS = new Set([
  "businessLicense",
  "taxId",
  "taxCertificate",
  "governmentId",
]);
// System field keys persisted as top-level draft columns (not documents).
const DRAFT_TOP_KEYS = new Set([
  "storeName",
  "description",
  "country",
  "state",
  "city",
  "address",
  "pincode",
  "phone",
]);

interface VendorRegistrationFormProps {
  locale: string;
  config: OnboardingConfig;
}

/**
 * The review step repeats the price the plan card already showed, so it uses
 * the same symbol-first formatting instead of a bare "USD 35000".
 */
function formatPlanPrice(price: number, currencyCode: string) {
  const currency = resolveCurrency(currencyCode);
  return formatCurrency(price, currency.code, currency.locale, {
    minimumFractionDigits: price % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function VendorRegistrationForm({
  locale,
  config,
}: VendorRegistrationFormProps) {
  const t = useTranslations("vendor.registration");
  const tAuth = useTranslations("auth");
  const tVendor = useTranslations("vendor");
  const tRoot = useTranslations();

  // Resolve a field/step's display label: admin override → i18n key → default.
  // next-intl returns the key (not throws) on a miss, so guard with `.has`.
  const tSafe = (key: string | undefined, fallback: string): string => {
    if (!key) return fallback;
    return tRoot.has(key as never) ? tRoot(key as never) : fallback;
  };
  const labelOf = (f: ResolvedField) =>
    f.label || tSafe(f.labelKey, f.defaultLabel);
  const stepLabelOf = (s: ResolvedStep) =>
    s.label || tSafe(s.labelKey, s.defaultLabel);
  const placeholderOf = (f: ResolvedField) => f.placeholder || undefined;

  const steps = config.steps;
  const stepKeys = useMemo(() => steps.map((s) => s.key), [steps]);
  const stepByKey = (key: string) => steps.find((s) => s.key === key);
  const accountStep = steps.find(
    (s) => s.kind === ONBOARDING_STEP_KINDS.ACCOUNT,
  );
  const firstNonAccountKey =
    stepKeys.find((k) => stepByKey(k)?.kind !== ONBOARDING_STEP_KINDS.ACCOUNT) ??
    stepKeys[0];
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [currentKey, setCurrentKey] = useState<string>(stepKeys[0] ?? "");
  const [planId, setPlanId] = useState<string>(config.defaultPlanId ?? "");
  // Which billing interval the plan grid shows. Seeded from the default plan's
  // interval (falling back to whichever interval the catalog actually offers)
  // so the pre-selected plan is visible on first render.
  const [billingView, setBillingView] = useState<BillingView>(() => {
    const seed =
      config.plans.find((p) => p.id === (config.defaultPlanId ?? "")) ??
      config.plans.find((p) => p.billingInterval !== "none");
    return seed?.billingInterval === "yearly" ? "yearly" : "monthly";
  });
  const [phoneCode, setPhoneCode] = useState("+91");
  const [existingApplication, setExistingApplication] = useState<{
    hasApplication: boolean;
    status: string | null;
    vendor?: unknown;
    canReapply?: boolean;
    rejectionReason?: string | null;
    /** The last submission, so "apply again" starts from it. */
    draft?: Record<string, unknown> | null;
  } | null>(null);

  const keyAfter = (key: string): string | undefined =>
    stepKeys[stepKeys.indexOf(key) + 1];
  const keyBefore = (key: string): string | undefined =>
    stepKeys[stepKeys.indexOf(key) - 1];
  const goNext = () => {
    const next = keyAfter(currentKey);
    if (next) setCurrentKey(next);
  };
  const goBackAndSave = () => {
    const prev = keyBefore(currentKey);
    if (!prev) return;
    saveDraft(prev);
    setCurrentKey(prev);
  };

  // Whether a Back button applies: there is a previous step, and we're not being
  // asked to step back into the account step after the account already exists.
  const canGoBack = (() => {
    const prev = keyBefore(currentKey);
    if (!prev) return false;
    if (isLoggedIn && stepByKey(prev)?.kind === ONBOARDING_STEP_KINDS.ACCOUNT)
      return false;
    return true;
  })();

  const selectedPlan = config.plans.find((p) => p.id === planId) ?? null;
  const selectedPlanTrialDays =
    selectedPlan &&
    selectedPlan.billingInterval !== "none" &&
    selectedPlan.price > 0
      ? Math.max(0, Math.floor(selectedPlan.trialDays ?? 0))
      : 0;
  // A trial plan is paid, but not before it has been used: no payment method is
  // asked for anywhere in this wizard, and the first charge falls due when the
  // trial ends. Mirrors `vendorPlanRequiresUpfrontPayment` on the server.
  const selectedPlanRequiresPayment = Boolean(
    selectedPlan &&
      selectedPlan.billingInterval !== "none" &&
      selectedPlan.price > 0 &&
      selectedPlanTrialDays === 0,
  );

  const currentIndex = stepKeys.indexOf(currentKey);
  // Furthest step the applicant has reached — completed steps stay freely
  // navigable via the stepper; the frontier step still needs validation.
  const [furthestIndex, setFurthestIndex] = useState(0);
  useApplyOnChange([currentKey, stepKeys], () => {
    setFurthestIndex((f) => Math.max(f, stepKeys.indexOf(currentKey)));
  });

  // Default form values for every resolved field across all steps.
  const defaultValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const step of steps) {
      for (const field of step.fields) {
        out[field.key] = field.widget === "checkbox" ? false : "";
      }
    }
    return out;
  }, [steps]);

  // Kept in a ref so the resolver below always reads the current value —
  // useForm captures its options once, on mount.
  const requiresAccountRef = useRef(true);
  useEffect(() => {
    requiresAccountRef.current = !isLoggedIn;
  }, [isLoggedIn]);

  const form = useForm<Record<string, unknown>>({
    resolver: (values, context, options) =>
      zodResolver(
        buildOnboardingSchema(
          steps,
          requiresAccountRef.current,
          labelOf,
        ) as never,
      )(values, context, options as never) as ReturnType<
        Resolver<Record<string, unknown>>
      >,
    defaultValues,
  });

  const selectedCountry = useWatch({ control: form.control, name: "country" }) as
    | string
    | undefined;
  const availableStates = selectedCountry ? STATES[selectedCountry] || [] : [];

  // Auto-fill the phone dialing code when a country is selected.
  useApplyOnChange([selectedCountry], () => {
    const dialCode = selectedCountry && COUNTRY_DIAL_CODES[selectedCountry];
    if (dialCode) setPhoneCode(dialCode);
  });

  // Prefill the form from a saved onboarding draft.
  const applyDraft = (draft: Record<string, unknown> | null | undefined) => {
    if (!draft) return;
    const next = { ...form.getValues() };
    for (const step of steps) {
      for (const field of step.fields) {
        if (field.system && DOC_KEYS.has(field.key)) {
          const docs = (draft.documents as Record<string, unknown>) || {};
          next[field.key] = docs[field.key] ?? "";
        } else if (field.system && DRAFT_TOP_KEYS.has(field.key)) {
          next[field.key] = draft[field.key] ?? next[field.key];
        } else if (!field.system) {
          const responses =
            (draft.responses as Record<string, unknown>) || {};
          if (responses[field.key] !== undefined)
            next[field.key] = responses[field.key];
        }
      }
    }
    form.reset(next);
    if (typeof draft.phoneCode === "string") setPhoneCode(draft.phoneCode);
    const plan = draft.plan as { planId?: string } | undefined;
    if (plan?.planId && config.plans.some((p) => p.id === plan.planId)) {
      setPlanId(plan.planId);
    }
  };

  // Resolve which step a saved draft resumes at. Prefers the stored stepKey,
  // clamps anything no longer in the flow to the first post-account step.
  const resolveResumeKey = (draft: Record<string, unknown>): string => {
    const candidate =
      typeof draft?.stepKey === "string" ? draft.stepKey : undefined;
    if (candidate && stepKeys.includes(candidate)) return candidate;
    return firstNonAccountKey;
  };

  useEffect(() => {
    async function checkStatus() {
      try {
        const { data: session } = await authClient.getSession();
        const loggedIn = !!session?.user;
        setIsLoggedIn(loggedIn);

        if (loggedIn) {
          setCurrentKey(firstNonAccountKey);
          const res = await fetch("/api/vendor/onboarding");
          const data = await res.json();
          if (data.success && data.data?.hasApplication) {
            setExistingApplication({
              hasApplication: true,
              status: data.data.status ?? null,
              canReapply: Boolean(data.data.canReapply),
              rejectionReason: data.data.rejectionReason ?? null,
              draft: data.data.draft ?? null,
            });
          } else if (data.success && data.data?.draft) {
            applyDraft(data.data.draft);
            setCurrentKey(resolveResumeKey(data.data.draft));
          }
        }
      } catch (error) {
        console.error("Failed to check status:", error);
      } finally {
        setIsLoading(false);
      }
    }
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Assemble the draft payload from the current field values.
  const buildDraftPayload = (targetKey: string, planOverride: string) => {
    const v = form.getValues();
    const documents: Record<string, unknown> = {};
    const responses: Record<string, unknown> = {};
    const top: Record<string, unknown> = {};
    for (const step of steps) {
      for (const field of step.fields) {
        const val = v[field.key];
        if (field.system && DOC_KEYS.has(field.key)) {
          documents[field.key] = val ?? "";
        } else if (field.system && DRAFT_TOP_KEYS.has(field.key)) {
          top[field.key] = val ?? "";
        } else if (!field.system) {
          responses[field.key] =
            val ?? (field.widget === "checkbox" ? false : "");
        }
      }
    }
    const plan = config.plans.find((p) => p.id === planOverride) ?? null;
    const legacyStep: Record<string, number> = {};
    stepKeys.forEach((k, i) => (legacyStep[k] = i + 1));
    return {
      step: legacyStep[targetKey] ?? 1,
      stepKey: targetKey,
        plan: {
          planId: planOverride,
          billingInterval: plan?.billingInterval ?? "none",
          startTrial:
            plan?.billingInterval !== "none" &&
            (plan?.trialDays ?? 0) > 0,
        },
      ...top,
      phoneCode,
      documents,
      responses,
    };
  };

  // Best-effort persistence of wizard progress. Never blocks the UI.
  const saveDraft = async (
    targetKey: string = currentKey,
    planOverride: string = planId,
  ) => {
    try {
      await fetch("/api/vendor/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDraftPayload(targetKey, planOverride)),
      });
    } catch {
      // Ignored — a failed save just means this keystroke can't be resumed.
    }
  };

  const buildApplicationPayload = (
    data: Record<string, unknown> = form.getValues(),
    planOverride: string = planId,
  ) => {
    const str = (k: string) => String(data[k] ?? "");
    const responses: Record<string, string | boolean> = {};
    for (const step of steps) {
      for (const field of step.fields) {
        if (!field.system) {
          responses[field.key] =
            field.widget === "checkbox"
              ? Boolean(data[field.key])
              : String(data[field.key] ?? "");
        }
      }
    }

    const address = {
      street: str("address"),
      city: str("city"),
      state: str("state"),
      postalCode: str("pincode"),
      country: str("country"),
      phone: str("phone")
        ? composeInternationalPhone(phoneCode, str("phone"))
        : "",
    };
    const hasAddress = Object.values(address).some(Boolean);

    return {
      storeName: str("storeName"),
      description: str("description") || `New store on ${DEFAULT_STORE_NAME}`,
      logo: null,
      banner: null,
      address: hasAddress ? address : null,
      socialLinks: null,
      bankDetails: null,
      documents: {
        businessLicense: str("businessLicense"),
        taxId: str("taxId"),
        taxCertificate: str("taxCertificate"),
        governmentId: str("governmentId"),
      },
      planId: planOverride || "",
      responses,
      termsAccepted,
    };
  };

  const fieldKeysOf = (step: ResolvedStep | undefined) =>
    (step?.fields ?? []).map((f) => f.key);

  /** Account step → create the account (document uploads need a session). */
  const handleAccountStep = async () => {
    const valid = await form.trigger(fieldKeysOf(accountStep));
    if (!valid) return;

    if (isLoggedIn) {
      setCurrentKey(firstNonAccountKey);
      return;
    }

    setIsCreatingAccount(true);
    try {
      const data = form.getValues();
      const result = await signUp.email({
        name: String(data.name ?? ""),
        email: String(data.email ?? ""),
        password: String(data.password ?? ""),
        emailVerificationAudience: "vendor",
      } as Parameters<typeof signUp.email>[0] & {
        emailVerificationAudience: "vendor";
      });

      if (result.error) {
        toast.error(result.error.message || "Failed to create account");
        return;
      }

      setIsLoggedIn(true);
      toast.success("Account created successfully!");
      const next = keyAfter(currentKey) ?? firstNonAccountKey;
      await saveDraft(next);
      setCurrentKey(next);
    } catch {
      toast.error("Failed to create account");
    } finally {
      setIsCreatingAccount(false);
    }
  };

  /** A business/custom fields step → validate its fields, save, advance. */
  const handleFieldsStep = async (stepKey: string) => {
    const valid = await form.trigger(fieldKeysOf(stepByKey(stepKey)));
    if (!valid) return;
    const next = keyAfter(stepKey);
    if (next) await saveDraft(next);
    goNext();
  };

  /** Subscription step → select the application plan, then review. */
  const handleSubscriptionStep = async () => {
    if (config.requirePlanSelection && !selectedPlan) {
      toast.error("Please select a plan to continue");
      return;
    }
    const next = keyAfter(currentKey);
    if (next) await saveDraft(next);
    goNext();
  };

  const selectPlan = (id: string) => {
    setPlanId(id);
    void saveDraft(currentKey, id);
  };

  // Jump straight to an already-visited step (save first). Used for backward /
  // completed-step navigation from the stepper.
  const goToKey = (key: string) => {
    if (key === currentKey) return;
    void saveDraft(key);
    setCurrentKey(key);
  };

  // Advance one step from the current one, running its validation (and the
  // account-creation flow on the account step).
  const advanceCurrent = () => {
    const k = stepByKey(currentKey)?.kind;
    if (k === ONBOARDING_STEP_KINDS.ACCOUNT) return void handleAccountStep();
    if (k === ONBOARDING_STEP_KINDS.SUBSCRIPTION)
      return void handleSubscriptionStep();
    void handleFieldsStep(currentKey);
  };

  // Stepper click: earlier / already-completed steps navigate directly;
  // the frontier step (current + 1) only advances if the current step validates.
  const onStepClick = (i: number) => {
    const target = steps[i];
    if (!target || i === currentIndex) return;
    // The account step can't be revisited once the account exists.
    if (isLoggedIn && target.kind === ONBOARDING_STEP_KINDS.ACCOUNT) return;
    if (i <= furthestIndex) {
      goToKey(target.key);
      return;
    }
    if (i === currentIndex + 1 && currentIndex === furthestIndex) {
      advanceCurrent();
    }
  };
  // Whether a stepper node is navigable (for cursor + a11y).
  const isStepClickable = (i: number) => {
    if (i === currentIndex) return false;
    if (isLoggedIn && steps[i]?.kind === ONBOARDING_STEP_KINDS.ACCOUNT)
      return false;
    if (i <= furthestIndex) return true;
    return i === currentIndex + 1 && currentIndex === furthestIndex;
  };

  const onSubmit = async (data: Record<string, unknown>) => {
    if (!termsAccepted) {
      toast.error("Please accept the vendor subscription terms");
      return;
    }
    setIsSubmitting(true);
    try {
      const str = (k: string) => String(data[k] ?? "");
      const payload = buildApplicationPayload(data);

      const res = await fetch("/api/vendor/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        toast.success(t("applicationSubmitted"));
        setExistingApplication({
          hasApplication: true,
          status: VENDOR_STATUS.PENDING,
          vendor: result.data?.vendor,
        });
      } else {
        toast.error(result.message || "Failed to submit application");
      }
    } catch {
      toast.error("An error occurred while submitting your application");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Re-open the wizard on the rejected submission. The server already accepts
  // a resubmission for a rejected vendor; this only puts the form back in
  // front of the applicant, prefilled, at the first step.
  const startReapply = () => {
    const draft = existingApplication?.draft ?? null;
    if (draft) applyDraft(draft);
    setTermsAccepted(false);
    setCurrentKey(draft ? resolveResumeKey(draft) : firstNonAccountKey);
    setExistingApplication(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (existingApplication?.hasApplication) {
    const status = existingApplication.status;
    return (
      <Card className="border shadow-sm">
        <CardContent className="pt-8 pb-8 text-center">
          {status === VENDOR_STATUS.PENDING && (
            <>
              <div className="inline-flex p-3 rounded-full bg-amber-100 mb-4">
                <Clock className="h-6 w-6 text-amber-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">
                {t("applicationPending")}
              </h3>
              <p className="text-sm text-gray-500">
                {t("applicationPendingDesc")}
              </p>
            </>
          )}
          {status === VENDOR_STATUS.APPROVED && (
            <>
              <div className="inline-flex p-3 rounded-full bg-green-100 mb-4">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">
                {t("applicationApproved")}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                {t("applicationApprovedDesc")}
              </p>
              <Button asChild>
                <a href={`/${locale}/vendor/dashboard`}>
                  {tVendor("goToDashboard")}{" "}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </>
          )}
          {status === VENDOR_STATUS.PAYMENT_REQUIRED && (
            <>
              <div className="mb-4 inline-flex rounded-full bg-blue-100 p-3">
                <Clock className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">
                Application approved, payment required
              </h3>
              <p className="mb-4 text-sm text-gray-500">
                Complete your selected subscription from the vendor dashboard to
                activate your store.
              </p>
              <Button asChild>
                <a href={`/${locale}/vendor/dashboard`}>
                  Complete payment <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </>
          )}
          {status === VENDOR_STATUS.REJECTED && (
            <>
              <div className="inline-flex p-3 rounded-full bg-red-100 mb-4">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">
                {t("applicationRejected")}
              </h3>
              <p className="text-sm text-gray-500">
                {existingApplication.canReapply
                  ? t("applicationRejectedReapplyDesc")
                  : t("applicationRejectedDesc")}
              </p>
              {existingApplication.rejectionReason ? (
                <div className="mx-auto mt-4 max-w-md rounded-lg border bg-muted/40 p-4 text-left text-sm">
                  <p className="mb-1 font-medium text-foreground">
                    {t("rejectionReasonLabel")}
                  </p>
                  <p className="whitespace-pre-line text-muted-foreground">
                    {existingApplication.rejectionReason}
                  </p>
                </div>
              ) : null}
              {existingApplication.canReapply ? (
                <Button type="button" className="mt-6" onClick={startReapply}>
                  {t("reapply")} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : null}
            </>
          )}
          {status === VENDOR_STATUS.SUSPENDED && (
            <>
              <div className="inline-flex p-3 rounded-full bg-red-100 mb-4">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">
                {t("applicationSuspended")}
              </h3>
              <p className="text-sm text-gray-500">
                {t("applicationSuspendedDesc")}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  const currentStep = stepByKey(currentKey);
  const kind = currentStep?.kind;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <Stepper
          steps={steps}
          currentKey={currentKey}
          accountDone={isLoggedIn}
          labelOf={stepLabelOf}
          onStepClick={onStepClick}
          isStepClickable={isStepClickable}
        />

        {/* ---------- Account step (signup) ---------- */}
        {kind === ONBOARDING_STEP_KINDS.ACCOUNT && currentStep && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {currentStep.fields.map((field) => (
                <OnboardingField
                  key={field.key}
                  field={field}
                  control={form.control}
                  label={labelOf(field)}
                  placeholder={placeholderOf(field)}
                  helpText={field.helpText}
                />
              ))}
            </div>

            <Button
              type="button"
              onClick={handleAccountStep}
              disabled={isCreatingAccount}
              className="w-full h-11 rounded-xl text-base font-semibold"
            >
              {isCreatingAccount ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating your account...
                </>
              ) : (
                <>
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              {tAuth("hasAccount")}{" "}
              <Link
                href={buildLoginUrl(locale, `/${locale}/become-vendor`)}
                className="text-primary font-medium hover:underline"
              >
                {tAuth("signIn")}
              </Link>
            </p>
          </div>
        )}

        {/* ---------- Business / custom fields steps ---------- */}
        {(kind === ONBOARDING_STEP_KINDS.BUSINESS ||
          kind === ONBOARDING_STEP_KINDS.CUSTOM) &&
          currentStep && (
            <div className="space-y-3.5">
              {groupFieldRows(currentStep.fields).map((row, i) => {
                const renderField = (field: ResolvedField) => (
                  <OnboardingField
                    key={field.key}
                    field={field}
                    control={form.control}
                    label={labelOf(field)}
                    placeholder={placeholderOf(field)}
                    helpText={field.helpText}
                    availableStates={availableStates}
                    onCountryChange={() => form.setValue("state", "")}
                    phoneCode={phoneCode}
                    onPhoneCodeChange={setPhoneCode}
                    onDocumentUploaded={() => saveDraft()}
                  />
                );
                if (row.length === 1) return renderField(row[0]);
                return (
                  <div
                    key={`row-${i}`}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                  >
                    {row.map(renderField)}
                  </div>
                );
              })}

              <div className="flex gap-3">
                {canGoBack && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goBackAndSave}
                    className="h-11 rounded-xl"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => handleFieldsStep(currentKey)}
                  className="h-11 flex-1 rounded-xl text-base font-semibold"
                >
                  {stepByKey(keyAfter(currentKey) ?? "")?.kind ===
                  ONBOARDING_STEP_KINDS.REVIEW
                    ? "Review"
                    : "Continue"}{" "}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

        {/* ---------- Subscription step (plan selection) ---------- */}
        {kind === ONBOARDING_STEP_KINDS.SUBSCRIPTION &&
          (() => {
            const hasMonthly = config.plans.some(
              (p) => p.billingInterval === "monthly",
            );
            const hasYearly = config.plans.some(
              (p) => p.billingInterval === "yearly",
            );
            const showToggle = hasMonthly && hasYearly;
            // A billing view shows plans of that interval plus always-relevant
            // free plans (interval "none").
            const visiblePlans = config.plans.filter(
              (p) =>
                p.billingInterval === "none" ||
                p.billingInterval === billingView,
            );

            return (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    Choose your plan
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Pick the subscription you want the admin to review with your
                    application.
                  </p>
                </div>

                {showToggle && (
                  <div className="flex justify-center">
                    <PlanBillingToggle
                      value={billingView}
                      onChange={setBillingView}
                    />
                  </div>
                )}

                <PlanGrid count={visiblePlans.length}>
                  {visiblePlans.map((plan) => {
                    const isSelected = plan.id === planId;
                    return (
                      <PricingPlanCard
                        key={plan.id}
                        plan={{
                          id: plan.id,
                          name: plan.name,
                          description: plan.description,
                          price: plan.price,
                          currency: plan.currency,
                          billingInterval: plan.billingInterval,
                          commissionRate: plan.commissionRate,
                          trialDays: plan.trialDays,
                          features: planFeatureLines(plan.features, plan.limits),
                        }}
                        highlighted={plan.isDefault}
                        selected={isSelected}
                        footer={
                          <Button
                            type="button"
                            onClick={() => selectPlan(plan.id)}
                            variant={
                              plan.isDefault
                                ? "secondary"
                                : isSelected
                                  ? "default"
                                  : "outline"
                            }
                            className="w-full"
                          >
                            {isSelected ? (
                              "Selected"
                            ) : (
                              "Select"
                            )}
                          </Button>
                        }
                      />
                    );
                  })}
                </PlanGrid>

                {config.requirePlanSelection && !selectedPlan && (
                  <p className="text-xs text-muted-foreground">
                    Please select a plan to continue.
                  </p>
                )}

                <div className="flex gap-3">
                  {canGoBack && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={goBackAndSave}
                      className="h-11 rounded-xl"
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                  )}
                <Button
                  type="button"
                  onClick={handleSubscriptionStep}
                  disabled={config.requirePlanSelection && !selectedPlan}
                  className="h-11 flex-1 rounded-xl text-base font-semibold"
                >
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                </div>
              </div>
            );
          })()}

        {/* ---------- Review step (preview + submit) ---------- */}
        {kind === ONBOARDING_STEP_KINDS.REVIEW && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Please review your details before submitting. You can go back and
              edit anything.
            </p>

            {steps
              .filter(
                (s) =>
                  s.kind !== ONBOARDING_STEP_KINDS.REVIEW &&
                  s.kind !== ONBOARDING_STEP_KINDS.SUBSCRIPTION &&
                  s.fields.length > 0,
              )
              .map((s) => (
                <ReviewSection key={s.key} title={stepLabelOf(s)}>
                  {s.fields.map((field) => (
                    <ReviewRow
                      key={field.key}
                      label={labelOf(field)}
                      value={reviewValue(field, form.getValues(), phoneCode)}
                    />
                  ))}
                </ReviewSection>
              ))}

            {config.plansEnabled && (
              <ReviewSection title="Plan">
                {selectedPlan ? (
                  <>
                    <ReviewRow label="Plan" value={selectedPlan.name} />
                    <ReviewRow
                      label="Price"
                      value={
                        selectedPlan.billingInterval === "none"
                          ? "Free"
                          : `${formatPlanPrice(
                              selectedPlan.price,
                              selectedPlan.currency,
                            )}/${
                              selectedPlan.billingInterval === "yearly"
                                ? "yr"
                                : "mo"
                            }`
                      }
                    />
                    <ReviewRow
                      label="Commission"
                      value={`${selectedPlan.commissionRate}% per sale`}
                    />
                    {selectedPlanRequiresPayment && (
                      <ReviewRow
                        label="Payment"
                        value="Due within 7 days after admin approval"
                      />
                    )}
                    {selectedPlanTrialDays > 0 && (
                      <ReviewRow
                        label="Payment"
                        value={`Free for ${selectedPlanTrialDays} days after approval — no payment method needed. Your first charge is due when the trial ends.`}
                      />
                    )}
                  </>
                ) : (
                  <ReviewRow
                    label="Plan"
                    value={`Default commission (${config.defaultCommissionRate}%)`}
                  />
                )}
              </ReviewSection>
            )}

            <div className="flex items-start gap-3 border-t pt-4">
              <Checkbox
                id="vendor-subscription-terms"
                checked={termsAccepted}
                onCheckedChange={(checked) =>
                  setTermsAccepted(checked === true)
                }
              />
              <label
                htmlFor="vendor-subscription-terms"
                className="text-sm leading-6 text-muted-foreground"
              >
                I agree to the{" "}
                <Link
                  href={`/${locale}/terms`}
                  target="_blank"
                  className="font-medium text-primary hover:underline"
                >
                  vendor and subscription terms
                </Link>
                . If a paid plan is approved, payment is due within 7 days and
                the subscription renews automatically until cancelled.
              </label>
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={goBackAndSave}
                disabled={isSubmitting}
                className="h-11 rounded-xl"
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !termsAccepted}
                className="h-11 flex-1 rounded-xl text-base font-semibold bg-gradient-to-r from-primary to-primary/80 shadow-lg shadow-primary/25 hover:from-primary/95 hover:to-primary/75"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating your store...
                  </>
                ) : (
                  t("submitButton")
                )}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Form>
  );
}

// Field-key pairs that should share a two-column row on the store step, so the
// step is more compact. Each field only pairs when its partner is present and
// adjacent-eligible; anything else (textareas, custom fields) stays full-width.
const TWO_COLUMN_PAIRS: [string, string][] = [
  ["country", "state"],
  ["city", "address"],
  ["pincode", "phone"],
];

/**
 * Group a step's fields into render rows: paired keys collapse into a single
 * two-item row, every other field stays on its own full-width row. Preserves
 * the original field order.
 */
function groupFieldRows(fields: ResolvedField[]): ResolvedField[][] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const partnerOf = new Map<string, string>();
  for (const [a, b] of TWO_COLUMN_PAIRS) {
    if (byKey.has(a) && byKey.has(b)) {
      partnerOf.set(a, b);
      partnerOf.set(b, a);
    }
  }

  const rows: ResolvedField[][] = [];
  const used = new Set<string>();
  for (const field of fields) {
    if (used.has(field.key)) continue;
    const partnerKey = partnerOf.get(field.key);
    const partner = partnerKey ? byKey.get(partnerKey) : undefined;
    if (partner && !used.has(partner.key)) {
      rows.push([field, partner]);
      used.add(field.key);
      used.add(partner.key);
    } else {
      rows.push([field]);
      used.add(field.key);
    }
  }
  return rows;
}

/** Display value for a field in the review summary. */
function reviewValue(
  field: ResolvedField,
  values: Record<string, unknown>,
  phoneCode: string,
): string {
  const raw = values[field.key];
  if (field.widget === "checkbox") return raw ? "Yes" : "No";
  // Only an actual upload widget shows "Uploaded" — taxId is a text value even
  // though it is grouped with the documents.
  if (field.widget === "document") return raw ? "Uploaded" : "";
  if (field.widget === "phone")
    return raw ? composeInternationalPhone(phoneCode, String(raw)) : "";
  if (field.widget === "password") return raw ? "••••••••" : "";
  if (field.widget === "country")
    return COUNTRIES.find((c) => c.value === raw)?.label || String(raw || "");
  if (field.widget === "state") {
    const countryCode = String(values.country || "");
    const list = countryCode ? STATES[countryCode] || [] : [];
    return list.find((s) => s.value === raw)?.label || String(raw || "");
  }
  return raw ? String(raw) : "";
}

function Stepper({
  steps,
  currentKey,
  accountDone,
  labelOf,
  onStepClick,
  isStepClickable,
}: {
  steps: ResolvedStep[];
  currentKey: string;
  accountDone: boolean;
  labelOf: (s: ResolvedStep) => string;
  onStepClick: (index: number) => void;
  isStepClickable: (index: number) => boolean;
}) {
  const currentIndex = steps.findIndex((s) => s.key === currentKey);
  return (
    <div className="flex items-center">
      {steps.map((step, index) => {
        const isDone =
          index < currentIndex ||
          (step.kind === ONBOARDING_STEP_KINDS.ACCOUNT && accountDone);
        const isCurrent = step.key === currentKey;
        const clickable = isStepClickable(index);

        return (
          <div
            key={step.key}
            className={cn("flex items-center", index > 0 && "flex-1")}
          >
            {index > 0 && (
              <div
                className={cn(
                  "mx-2 h-px flex-1",
                  isDone || isCurrent ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <button
              type="button"
              onClick={() => clickable && onStepClick(index)}
              disabled={!clickable}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "group flex items-center gap-2 rounded-full",
                clickable ? "cursor-pointer" : "cursor-default",
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  isDone && "border-primary bg-primary text-primary-foreground",
                  isCurrent && !isDone && "border-primary text-primary",
                  !isDone && !isCurrent && "border-border text-muted-foreground",
                  clickable && "group-hover:border-primary",
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  "hidden text-xs font-medium transition-colors sm:inline",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                  clickable && "group-hover:text-foreground",
                )}
              >
                {labelOf(step)}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">
        {value || <span className="text-muted-foreground/60">—</span>}
      </dd>
    </div>
  );
}
