"use client";

import { useMemo, useState } from "react";
import { FilePlus2, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface WhatsAppTemplateAuthoringProps {
  connectionId: string;
  disabled?: boolean;
}

function variableCount(value: string) {
  const numbers = [...value.matchAll(/{{\s*(\d+)\s*}}/g)].map((match) =>
    Number(match[1]),
  );
  return numbers.length ? Math.max(...numbers) : 0;
}

export function WhatsAppTemplateAuthoring({
  connectionId,
  disabled = false,
}: WhatsAppTemplateAuthoringProps) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    language: "en_US",
    category: "UTILITY" as "UTILITY" | "MARKETING" | "AUTHENTICATION",
    headerText: "",
    headerExample: "",
    bodyText: "",
    bodyExamples: [] as string[],
    footerText: "",
    buttonType: "NONE" as
      | "NONE"
      | "QUICK_REPLY"
      | "URL"
      | "PHONE_NUMBER",
    buttonText: "",
    buttonValue: "",
    buttonExample: "",
    addSecurityRecommendation: true,
    codeExpirationMinutes: 10,
  });
  const headerHasVariable = /{{\s*1\s*}}/.test(form.headerText);
  const bodyVariableCount = useMemo(
    () => variableCount(form.bodyText),
    [form.bodyText],
  );

  const submit = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/chat/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          ...form,
          headerText:
            form.category === "AUTHENTICATION"
              ? undefined
              : form.headerText || undefined,
          headerExample:
            form.category === "AUTHENTICATION"
              ? undefined
              : form.headerExample || undefined,
          footerText:
            form.category === "AUTHENTICATION"
              ? undefined
              : form.footerText || undefined,
          bodyExamples:
            form.category === "AUTHENTICATION"
              ? []
              : Array.from(
                  { length: bodyVariableCount },
                  (_, index) => form.bodyExamples[index] || "",
                ),
          button:
            form.category !== "AUTHENTICATION" &&
            form.buttonType !== "NONE"
              ? {
                  type: form.buttonType,
                  text: form.buttonText,
                  value: form.buttonValue || undefined,
                  example: form.buttonExample || undefined,
                }
              : undefined,
          authentication:
            form.category === "AUTHENTICATION"
              ? {
                  addSecurityRecommendation:
                    form.addSecurityRecommendation,
                  codeExpirationMinutes: form.codeExpirationMinutes,
                }
              : undefined,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || tr("templateAuthoring.submitFailed", "Unable to submit template"));
      }
      // Keep Meta's returned status in the toast: PENDING and APPROVED mean
      // very different things to the admin who just submitted, and dropping it
      // for the sake of translation would remove real information.
      toast.success(
        tr(
          "templateAuthoring.submittedWithStatus",
          "Template submitted for review (status: {status})",
        ).replace("{status}", String(payload.data.template.status)),
      );
      setForm({
        name: "",
        language: "en_US",
        category: "UTILITY",
        headerText: "",
        headerExample: "",
        bodyText: "",
        bodyExamples: [],
        footerText: "",
        buttonType: "NONE",
        buttonText: "",
        buttonValue: "",
        buttonExample: "",
        addSecurityRecommendation: true,
        codeExpirationMinutes: 10,
      });
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tr("templateAuthoring.submitFailed", "Unable to submit template"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <FilePlus2 />
        {tr("templateAuthoring.create", "Create text template")}
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {tr("templateAuthoring.submit", "Submit WhatsApp text template")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr("templateAuthoring.reviewNote", "Meta reviews new templates before they can be used.")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={saving}
          onClick={() => setOpen(false)}
          aria-label={tr("templateAuthoring.close", "Close template form")}
        >
          <X />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`template-name-${connectionId}`}>
            {tr("templateAuthoring.name", "Template name")}
          </Label>
          <Input
            id={`template-name-${connectionId}`}
            value={form.name}
            placeholder="order_status_update"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                name: event.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_]/g, "_"),
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`template-language-${connectionId}`}>
            {tr("templateAuthoring.language", "Language code")}
          </Label>
          <Input
            id={`template-language-${connectionId}`}
            value={form.language}
            placeholder="en_US"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                language: event.target.value,
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`template-category-${connectionId}`}>
            {tr("templateAuthoring.category", "Category")}
          </Label>
          <select
            id={`template-category-${connectionId}`}
            value={form.category}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                category: event.target.value as
                  | "UTILITY"
                  | "MARKETING"
                  | "AUTHENTICATION",
              }))
            }
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="UTILITY">{tr("templateAuthoring.utility", "Utility")}</option>
            <option value="MARKETING">{tr("templateAuthoring.marketing", "Marketing")}</option>
            {/*
              Authentication is withheld on purpose: the send compiler cannot
              build the OTP button component Meta requires, so the template
              would be approved and then permanently unsendable. The
              authoring branches below are kept intact so restoring the option
              is a one-line change once OTP sending is supported.
            */}
          </select>
        </div>
      </div>

      {form.category !== "AUTHENTICATION" ? (
      <div className="space-y-2">
        <Label htmlFor={`template-header-${connectionId}`}>
          {tr("templateAuthoring.textHeaderOptional", "Text header (optional)")}
        </Label>
        <Input
          id={`template-header-${connectionId}`}
          value={form.headerText}
          maxLength={60}
          placeholder={tr(
            "templateAuthoring.headerPlaceholder",
            "Order {{1}} update",
          )}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              headerText: event.target.value,
            }))
          }
        />
      </div>
      ) : null}
      {form.category !== "AUTHENTICATION" && headerHasVariable ? (
        <div className="space-y-2">
          <Label htmlFor={`template-header-example-${connectionId}`}>
            {tr("templateAuthoring.headerExampleLabel", "Header variable example")}
          </Label>
          <Input
            id={`template-header-example-${connectionId}`}
            value={form.headerExample}
            placeholder="#1001"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                headerExample: event.target.value,
              }))
            }
          />
        </div>
      ) : null}

      {form.category !== "AUTHENTICATION" ? (
      <div className="space-y-2">
        <Label htmlFor={`template-body-${connectionId}`}>
          {tr("templateAuthoring.body", "Body")}
        </Label>
        <Textarea
          id={`template-body-${connectionId}`}
          value={form.bodyText}
          maxLength={1024}
          placeholder={tr(
            "templateAuthoring.bodyPlaceholder",
            "Hi {{1}}, your order is now {{2}}.",
          )}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              bodyText: event.target.value,
            }))
          }
        />
        <p className="text-xs text-muted-foreground">
          {tr(
            "templateAuthoring.placeholderHint",
            "Use sequential placeholders: {{1}}, {{2}}, and so on.",
          )}
        </p>
      </div>
      ) : (
        <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.addSecurityRecommendation}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  addSecurityRecommendation: event.target.checked,
                }))
              }
            />
            {tr("templateAuthoring.securityRecommendation", "Add security recommendation")}
          </label>
          <div className="space-y-2">
            <Label htmlFor={`template-code-expiry-${connectionId}`}>
              {tr("templateAuthoring.codeExpiration", "Code expiration (minutes)")}
            </Label>
            <NumberInput
              id={`template-code-expiry-${connectionId}`}
              min={1}
              max={90}
              step={1}
              value={form.codeExpirationMinutes}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next === undefined) return;
                setForm((current) => ({ ...current, codeExpirationMinutes: next }));
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {tr(
              "templateAuthoring.authenticationNote",
              "Meta controls authentication-template wording and adds the required copy-code button.",
            )}
          </p>
        </div>
      )}

      {form.category !== "AUTHENTICATION" &&
        Array.from({ length: bodyVariableCount }, (_, index) => (
        <div key={index} className="space-y-2">
          <Label htmlFor={`template-body-example-${connectionId}-${index}`}>
            {tr(
              "templateAuthoring.bodyExampleLabel",
              "Body {variable} example",
            ).replace("{variable}", `{{${index + 1}}}`)}
          </Label>
          <Input
            id={`template-body-example-${connectionId}-${index}`}
            value={form.bodyExamples[index] || ""}
            onChange={(event) =>
              setForm((current) => {
                const bodyExamples = [...current.bodyExamples];
                bodyExamples[index] = event.target.value;
                return { ...current, bodyExamples };
              })
            }
          />
        </div>
        ))}

      {form.category !== "AUTHENTICATION" ? (
      <div className="space-y-2">
        <Label htmlFor={`template-footer-${connectionId}`}>
          {tr("templateAuthoring.footerOptional", "Footer (optional)")}
        </Label>
        <Input
          id={`template-footer-${connectionId}`}
          value={form.footerText}
          maxLength={60}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              footerText: event.target.value,
            }))
          }
        />
      </div>
      ) : null}

      {form.category !== "AUTHENTICATION" ? (
        <div className="space-y-3 rounded-lg border p-4">
          <Label>{tr("templateAuthoring.richButton", "Optional rich button")}</Label>
          <select
            value={form.buttonType}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                buttonType: event.target.value as typeof current.buttonType,
              }))
            }
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="NONE">{tr("templateAuthoring.noButtonOption", "No button")}</option>
            <option value="QUICK_REPLY">{tr("templateAuthoring.quickReplyOption", "Quick reply")}</option>
            <option value="URL">{tr("templateAuthoring.websiteUrlOption", "Website URL")}</option>
            <option value="PHONE_NUMBER">{tr("templateAuthoring.phoneNumberOption", "Phone number")}</option>
          </select>
          {form.buttonType !== "NONE" ? (
            <Input
              value={form.buttonText}
              maxLength={25}
              placeholder={tr("templateAuthoring.buttonLabel", "Button label")}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  buttonText: event.target.value,
                }))
              }
            />
          ) : null}
          {form.buttonType === "URL" ||
          form.buttonType === "PHONE_NUMBER" ? (
            <Input
              value={form.buttonValue}
              placeholder={
                form.buttonType === "URL"
                  ? "https://example.com/order/{{1}}"
                  : "+8801700000000"
              }
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  buttonValue: event.target.value,
                }))
              }
            />
          ) : null}
          {form.buttonType === "URL" &&
          /{{\s*1\s*}}/.test(form.buttonValue) ? (
            <Input
              value={form.buttonExample}
              placeholder="https://example.com/order/1001"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  buttonExample: event.target.value,
                }))
              }
            />
          ) : null}
        </div>
      ) : null}

      <Button
        type="button"
        disabled={
          disabled ||
          saving ||
          !form.name.trim() ||
          !form.language.trim() ||
          (form.category !== "AUTHENTICATION" &&
            (!form.bodyText.trim() ||
              (headerHasVariable && !form.headerExample.trim()) ||
              Array.from({ length: bodyVariableCount }).some(
                (_, index) => !form.bodyExamples[index]?.trim(),
              ))) ||
          (form.category !== "AUTHENTICATION" &&
            ((form.buttonType !== "NONE" && !form.buttonText.trim()) ||
              ((form.buttonType === "URL" ||
                form.buttonType === "PHONE_NUMBER") &&
                !form.buttonValue.trim())))
        }
        onClick={() => void submit()}
      >
        {saving ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
        {tr("templateAuthoring.submitForReview", "Submit for Meta review")}
      </Button>
    </div>
  );
}
