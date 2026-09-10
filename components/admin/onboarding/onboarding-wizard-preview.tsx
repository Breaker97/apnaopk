"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { OnboardingField } from "@/components/vendor/onboarding/field-renderer";
import { resolveEditableForPreview } from "@/lib/vendors/onboarding-template-editor";
import type { EditableTemplate } from "@/lib/vendors/onboarding-template-editor";
import { ONBOARDING_STEP_KINDS } from "@/lib/vendors/vendor-onboarding-fields";
import type {
  PublicVendorPlan,
  ResolvedField,
  ResolvedStep,
} from "@/lib/vendors/vendor-onboarding";
import { PricingPlanCard } from "@/components/vendor-plans/pricing-plan-card";
import { PlanGrid } from "@/components/vendor-plans/plan-grid";
import {
  PlanBillingToggle,
  type BillingView,
} from "@/components/vendor-plans/plan-billing-toggle";
import { planFeatureLines } from "@/components/vendor-plans/plan-feature-lines";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/**
 * Pixel-for-pixel preview of the live storefront become-a-vendor wizard for the
 * current (unsaved) template — same wrapper, stepper, per-step layout, plan
 * cards and review the storefront renders (via the shared `OnboardingField`).
 * Inputs are disabled; only step navigation is live so the admin can walk the
 * whole flow exactly as an applicant would see it.
 */
export function OnboardingWizardPreview({
  template,
  plansEnabled,
  plans,
  defaultCommissionRate,
}: {
  template: EditableTemplate;
  plansEnabled: boolean;
  plans: PublicVendorPlan[];
  defaultCommissionRate: number;
}) {
  const t = useTranslations();
  const tSafe = (key: string | undefined, fallback: string) =>
    key && t.has(key as never) ? t(key as never) : fallback;
  const labelOf = (f: ResolvedField) => f.label || tSafe(f.labelKey, f.defaultLabel);
  const stepLabelOf = (s: ResolvedStep) =>
    s.label || tSafe(s.labelKey, s.defaultLabel);

  // Drop the subscription step from the preview flow when plans are off, to
  // match the storefront gating exactly.
  const steps = useMemo(
    () =>
      resolveEditableForPreview(template).filter(
        (s) => s.kind !== ONBOARDING_STEP_KINDS.SUBSCRIPTION || plansEnabled,
      ),
    [template, plansEnabled],
  );
  const stepKeys = steps.map((s) => s.key);

  const [currentKey, setCurrentKey] = useState(stepKeys[0] ?? "");
  const [billingView, setBillingView] = useState<BillingView>("monthly");
  // Keep the active step valid as the admin edits the flow.
  useApplyOnChange([stepKeys.join("|")], () => {
    if (!stepKeys.includes(currentKey)) setCurrentKey(stepKeys[0] ?? "");
  });

  const idx = steps.findIndex((s) => s.key === currentKey);
  const current = steps[idx];
  const goNext = () => steps[idx + 1] && setCurrentKey(steps[idx + 1].key);
  const goBack = () => steps[idx - 1] && setCurrentKey(steps[idx - 1].key);

  const defaultValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const step of steps)
      for (const f of step.fields)
        out[f.key] = f.widget === "checkbox" ? false : "";
    return out;
  }, [steps]);
  const form = useForm<Record<string, unknown>>({ defaultValues });

  const kind = current?.kind;

  return (
    <div className="rounded-2xl bg-muted/30 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header — mirrors the become-vendor page */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {tSafe("vendor.registration.startSelling", "Start Selling Today")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {tSafe(
              "vendor.registration.joinUs",
              "Join thousands of successful sellers",
            )}
          </p>
        </div>

        <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-xl shadow-black/4 sm:p-6">
          <Form {...form}>
            <div className="space-y-5">
              <Stepper
                steps={steps}
                currentKey={currentKey}
                labelOf={stepLabelOf}
                onStepClick={(i) => steps[i] && setCurrentKey(steps[i].key)}
              />

              {/* Account / business / custom → field lists */}
              {(kind === ONBOARDING_STEP_KINDS.ACCOUNT ||
                kind === ONBOARDING_STEP_KINDS.BUSINESS ||
                kind === ONBOARDING_STEP_KINDS.CUSTOM) &&
                current && (
                  <div className="space-y-3.5">
                    <div
                      className={cn(
                        kind === ONBOARDING_STEP_KINDS.ACCOUNT
                          ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
                          : "space-y-3.5",
                      )}
                    >
                      {current.fields.map((field) => (
                        <OnboardingField
                          key={field.key}
                          field={field}
                          control={form.control}
                          label={labelOf(field)}
                          placeholder={field.placeholder || undefined}
                          helpText={field.helpText}
                          disabled
                        />
                      ))}
                      {current.fields.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No fields in this step yet.
                        </p>
                      )}
                    </div>

                    {kind === ONBOARDING_STEP_KINDS.ACCOUNT ? (
                      <>
                        <Button
                          type="button"
                          onClick={goNext}
                          className="h-11 w-full rounded-xl text-base font-semibold"
                        >
                          Continue <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                        <p className="text-center text-sm text-muted-foreground">
                          Already have an account?{" "}
                          <span className="font-medium text-primary">Sign in</span>
                        </p>
                      </>
                    ) : (
                      <NavButtons
                        canBack={idx > 0}
                        onBack={goBack}
                        onNext={goNext}
                        nextLabel={
                          steps[idx + 1]?.kind === ONBOARDING_STEP_KINDS.REVIEW
                            ? "Review"
                            : "Continue"
                        }
                      />
                    )}
                  </div>
                )}

              {/* Subscription → plan cards */}
              {kind === ONBOARDING_STEP_KINDS.SUBSCRIPTION &&
                (() => {
                  const hasMonthly = plans.some(
                    (p) => p.billingInterval === "monthly",
                  );
                  const hasYearly = plans.some(
                    (p) => p.billingInterval === "yearly",
                  );
                  const showToggle = hasMonthly && hasYearly;
                  const visiblePlans = plans.filter(
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
                          Pick the subscription that fits your business. You can
                          change it later.
                        </p>
                      </div>

                      {plans.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                          No active plans yet — add plans under Vendor Plans.
                        </p>
                      ) : (
                        <>
                          {showToggle && (
                            <div className="flex justify-center">
                              <PlanBillingToggle
                                value={billingView}
                                onChange={setBillingView}
                              />
                            </div>
                          )}
                          <PlanGrid count={visiblePlans.length}>
                            {visiblePlans.map((plan, i) => (
                              <PricingPlanCard
                                key={plan.id}
                                plan={{
                                  id: plan.id,
                                  name: plan.name,
                                  description: plan.description,
                                  price: plan.price,
                                  billingInterval: plan.billingInterval,
                                  commissionRate: plan.commissionRate,
                                  trialDays: plan.trialDays,
                                  features: planFeatureLines(
                                    plan.features,
                                    plan.limits,
                                  ),
                                }}
                                highlighted={plan.isDefault}
                                selected={i === 0}
                                footer={
                                  <Button
                                    type="button"
                                    disabled
                                    variant={
                                      plan.isDefault ? "secondary" : "outline"
                                    }
                                    className="w-full"
                                  >
                                    Purchase
                                  </Button>
                                }
                              />
                            ))}
                          </PlanGrid>
                        </>
                      )}

                      <NavButtons
                        canBack={idx > 0}
                        onBack={goBack}
                        onNext={goNext}
                      />
                    </div>
                  );
                })()}

              {/* Review → summary */}
              {kind === ONBOARDING_STEP_KINDS.REVIEW && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Please review your details before submitting. You can go back
                    and edit anything.
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
                        {s.fields.map((f) => (
                          <ReviewRow key={f.key} label={labelOf(f)} />
                        ))}
                      </ReviewSection>
                    ))}

                  {plansEnabled && (
                    <ReviewSection title="Plan">
                      <ReviewRow
                        label="Plan"
                        value={
                          plans[0]?.name ??
                          `Default commission (${defaultCommissionRate}%)`
                        }
                      />
                    </ReviewSection>
                  )}

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={goBack}
                      className="h-11 rounded-xl"
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button
                      type="button"
                      disabled
                      className="h-11 flex-1 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-base font-semibold shadow-lg shadow-primary/25"
                    >
                      Submit
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}

function NavButtons({
  canBack,
  onBack,
  onNext,
  nextLabel = "Continue",
}: {
  canBack: boolean;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="flex gap-3">
      {canBack && (
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="h-11 rounded-xl"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      )}
      <Button
        type="button"
        onClick={onNext}
        className="h-11 flex-1 rounded-xl text-base font-semibold"
      >
        {nextLabel} <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

function Stepper({
  steps,
  currentKey,
  labelOf,
  onStepClick,
}: {
  steps: ResolvedStep[];
  currentKey: string;
  labelOf: (s: ResolvedStep) => string;
  onStepClick: (index: number) => void;
}) {
  const currentIndex = steps.findIndex((s) => s.key === currentKey);
  return (
    <div className="flex items-center">
      {steps.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = step.key === currentKey;
        // In the preview every step is freely inspectable.
        const clickable = !isCurrent;
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
