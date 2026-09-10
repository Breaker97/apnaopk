"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Plug, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Settings } from "@/components/admin/settings/types";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { credentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type AiAuthoringSettings = NonNullable<Settings["aiAuthoring"]>;

const TEXT_MODELS: Array<{ value: string; label: string }> = [
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini — fast, low cost" },
  { value: "gpt-4.1", label: "GPT-4.1 — higher quality" },
  { value: "gpt-5-mini", label: "GPT-5 mini" },
  { value: "gpt-5", label: "GPT-5 — best quality" },
];

const IMAGE_MODELS: Array<{ value: string; label: string }> = [
  { value: "gpt-image-1", label: "GPT Image 1 — best quality" },
  { value: "gpt-image-1-mini", label: "GPT Image 1 mini — lower cost" },
];

/** Sentinel for "inherit env/default" since Select can't hold "". */
const DEFAULT_MODEL_VALUE = "__default__";

const SURFACE_KEYS = [
  "products",
  "categories",
  "collections",
  "brands",
  "blogPosts",
  "contentPages",
  "reviews",
  "heroBanner",
] as const;

const TONES = ["friendly", "professional", "luxury", "playful", "supportive"];

export function AiSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;
  const ai = (settings.aiAuthoring || {}) as Partial<AiAuthoringSettings>;
  const apiKeySet = credentialMeta(settings, "aiAuthoring.apiKey").set;
  const envKeySet = Boolean(settings._meta?.envSources?.ai?.apiKey);
  const configured = apiKeySet || envKeySet || Boolean(ai.apiKey?.trim());

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const tSafe = useFallbackTranslator(t);

  const surfaceLabel = (key: (typeof SURFACE_KEYS)[number]) =>
    tSafe(
      `admin.settings.ai.surfaces.${key}`,
      {
        products: "Products",
        categories: "Categories",
        collections: "Collections",
        brands: "Brands",
        blogPosts: "Blog posts",
        contentPages: "Content pages",
        reviews: "Reviews & replies",
        heroBanner: "Hero banners",
      }[key],
    );

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/admin/settings/test-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: ai.apiKey || "" }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
      };
      setTestResult({
        success: Boolean(result.success),
        message:
          result.message ||
          tSafe("admin.settings.ai.testFailed", "Connection test failed"),
      });
    } catch {
      setTestResult({
        success: false,
        message: tSafe("admin.settings.ai.testFailed", "Connection test failed"),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={tSafe("admin.settings.ai.title", "AI")}
        description={tSafe(
          "admin.settings.ai.description",
          "One place to configure AI Studio content, SEO, and image generation.",
        )}
        meta={
          configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {tSafe("admin.settings.ai.statusConfigured", "Configured")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              <TriangleAlert className="h-3.5 w-3.5" />
              {tSafe("admin.settings.ai.statusNotConfigured", "Not configured")}
            </span>
          )
        }
      />

      {/* Provider */}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="ai-enabled" className="text-sm font-medium">
                {tSafe("admin.settings.ai.enabled", "Enable AI features")}
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.ai.enabledHint",
                  "Turns the AI Studio and every AI button on or off across the dashboard.",
                )}
              </p>
            </div>
            <Switch
              id="ai-enabled"
              checked={ai.enabled !== false}
              onCheckedChange={(checked) =>
                updateNestedField("aiAuthoring.enabled", checked)
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-api-key">
              {tSafe("admin.settings.ai.apiKey", "OpenAI API key")}
            </Label>
            <SecretInput
              id="ai-api-key"
              value={ai.apiKey || ""}
              secretSet={apiKeySet}
              maskedHint={credentialMeta(settings, "aiAuthoring.apiKey").hint}
              placeholderWhenSet={tSafe(
                "admin.settings.ai.apiKeySetPlaceholder",
                "••••••••  (saved — enter a new key to replace)",
              )}
              placeholderWhenUnset="sk-..."
              onChange={(value: string) =>
                updateNestedField("aiAuthoring.apiKey", value)
              }
              onClear={() => updateNestedField("aiAuthoring.apiKey", null)}
            />
            <EnvSourceHint show={envKeySet} />
            <p className="text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.ai.apiKeyHint",
                "Used by AI Studio and the AI Sales Agent. Leave empty to keep using the OPENAI_API_KEY environment variable.",
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={testing}
              onClick={testConnection}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              {tSafe("admin.settings.ai.testConnection", "Test Connection")}
            </Button>
            {testResult ? (
              <span
                className={cn(
                  "text-sm",
                  testResult.success
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive",
                )}
              >
                {testResult.message}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Models */}
      <Card>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{tSafe("admin.settings.ai.textModel", "Text model")}</Label>
            <Select
              value={ai.textModel || DEFAULT_MODEL_VALUE}
              onValueChange={(value) =>
                updateNestedField(
                  "aiAuthoring.textModel",
                  value === DEFAULT_MODEL_VALUE ? "" : value,
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL_VALUE}>
                  {tSafe(
                    "admin.settings.ai.modelDefault",
                    "Default (gpt-4.1-mini or environment override)",
                  )}
                </SelectItem>
                {TEXT_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{tSafe("admin.settings.ai.imageModel", "Image model")}</Label>
            <Select
              value={ai.imageModel || DEFAULT_MODEL_VALUE}
              onValueChange={(value) =>
                updateNestedField(
                  "aiAuthoring.imageModel",
                  value === DEFAULT_MODEL_VALUE ? "" : value,
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL_VALUE}>
                  {tSafe(
                    "admin.settings.ai.modelDefault",
                    "Default (gpt-image-1 or environment override)",
                  )}
                </SelectItem>
                {IMAGE_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              {tSafe("admin.settings.ai.imageSize", "Default image size")}
            </Label>
            <Select
              value={ai.imageDefaults?.size || "auto"}
              onValueChange={(value) =>
                updateNestedField("aiAuthoring.imageDefaults.size", value)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["auto", "1024x1024", "1024x1536", "1536x1024"].map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              {tSafe("admin.settings.ai.imageQuality", "Default image quality")}
            </Label>
            <Select
              value={ai.imageDefaults?.quality || "high"}
              onValueChange={(value) =>
                updateNestedField("aiAuthoring.imageDefaults.quality", value)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["auto", "medium", "high"].map((quality) => (
                  <SelectItem key={quality} value={quality}>
                    {quality}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.ai.imageQualityHint",
                "Higher quality costs more per image.",
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Surfaces */}
      <Card>
        <CardContent className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              {tSafe("admin.settings.ai.surfacesTitle", "Where AI is available")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.ai.surfacesHint",
                "Turn AI generation off for specific areas of the dashboard.",
              )}
            </p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {SURFACE_KEYS.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <Label htmlFor={`ai-surface-${key}`} className="text-sm">
                  {surfaceLabel(key)}
                </Label>
                <Switch
                  id={`ai-surface-${key}`}
                  checked={ai.surfaces?.[key] !== false}
                  onCheckedChange={(checked) =>
                    updateNestedField(`aiAuthoring.surfaces.${key}`, checked)
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Brand voice */}
      <Card>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">
              {tSafe("admin.settings.ai.brandVoiceTitle", "Brand voice")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.ai.brandVoiceHint",
                "Applied to every AI text generation unless a request overrides it.",
              )}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tSafe("admin.settings.ai.tone", "Default tone")}</Label>
              <Select
                value={ai.brandVoice?.tone || DEFAULT_MODEL_VALUE}
                onValueChange={(value) =>
                  updateNestedField(
                    "aiAuthoring.brandVoice.tone",
                    value === DEFAULT_MODEL_VALUE ? "" : value,
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MODEL_VALUE}>
                    {tSafe("admin.settings.ai.toneNone", "No default tone")}
                  </SelectItem>
                  {TONES.map((tone) => (
                    <SelectItem key={tone} value={tone}>
                      {tone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="ai-brand-instructions">
                {tSafe(
                  "admin.settings.ai.brandInstructions",
                  "Style guidance (optional)",
                )}
              </Label>
              <Textarea
                id="ai-brand-instructions"
                rows={3}
                maxLength={2000}
                value={ai.brandVoice?.instructions || ""}
                onChange={(event) =>
                  updateNestedField(
                    "aiAuthoring.brandVoice.instructions",
                    event.target.value,
                  )
                }
                placeholder={tSafe(
                  "admin.settings.ai.brandInstructionsPlaceholder",
                  'e.g. "Write for outdoor enthusiasts. Short sentences. Avoid superlatives."',
                )}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="ai-image-style">
                {tSafe(
                  "admin.settings.ai.imageStyle",
                  "Image style guidance (optional)",
                )}
              </Label>
              <Textarea
                id="ai-image-style"
                rows={2}
                maxLength={1000}
                value={ai.brandVoice?.imageStyle || ""}
                onChange={(event) =>
                  updateNestedField(
                    "aiAuthoring.brandVoice.imageStyle",
                    event.target.value,
                  )
                }
                placeholder={tSafe(
                  "admin.settings.ai.imageStylePlaceholder",
                  'e.g. "Soft natural light, warm neutral palette, minimal props."',
                )}
              />
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.ai.imageStyleHint",
                  "Applied to generated images (not edits) so product visuals stay on-brand.",
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Brand kit */}
      <Card>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">
              {tSafe("admin.settings.ai.brandKitTitle", "Brand kit")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.ai.brandKitHint",
                "Colors and logo used when generating images and exporting social sizes.",
              )}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ["primaryColor", "admin.settings.ai.primaryColor", "Primary brand color"],
                ["secondaryColor", "admin.settings.ai.secondaryColor", "Secondary brand color"],
              ] as const
            ).map(([field, key, fallback]) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`ai-brand-${field}`}>{tSafe(key, fallback)}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={tSafe(key, fallback)}
                    value={ai.brandKit?.[field] || "#000000"}
                    onChange={(event) =>
                      updateNestedField(
                        `aiAuthoring.brandKit.${field}`,
                        event.target.value,
                      )
                    }
                    className="h-9 w-12 shrink-0 cursor-pointer rounded border bg-transparent p-1"
                  />
                  <Input
                    id={`ai-brand-${field}`}
                    value={ai.brandKit?.[field] || ""}
                    maxLength={9}
                    placeholder="#000000"
                    onChange={(event) =>
                      updateNestedField(
                        `aiAuthoring.brandKit.${field}`,
                        event.target.value,
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-brand-logo">
              {tSafe("admin.settings.ai.logoUrl", "Brand logo URL")}
            </Label>
            <Input
              id="ai-brand-logo"
              value={ai.brandKit?.logoUrl || ""}
              placeholder="https://…/logo.png"
              onChange={(event) =>
                updateNestedField(
                  "aiAuthoring.brandKit.logoUrl",
                  event.target.value,
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.ai.logoUrlHint",
                "Upload your logo to the store, then paste its URL here. Used as an optional lockup on social exports.",
              )}
            </p>
            {ai.brandKit?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ai.brandKit.logoUrl}
                alt=""
                className="mt-1 h-10 w-auto rounded border bg-muted/30 object-contain p-1"
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Access + limits */}
      <Card>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">
              {tSafe("admin.settings.ai.accessTitle", "Access & daily limits")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.ai.accessHint",
                "Limits are per user per day. 0 means unlimited.",
              )}
            </p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <Label htmlFor="ai-access-staff" className="text-sm">
                {tSafe("admin.settings.ai.staffEnabled", "Allow staff accounts")}
              </Label>
              <Switch
                id="ai-access-staff"
                checked={ai.access?.staffEnabled !== false}
                onCheckedChange={(checked) =>
                  updateNestedField("aiAuthoring.access.staffEnabled", checked)
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <Label htmlFor="ai-access-vendors" className="text-sm">
                {tSafe(
                  "admin.settings.ai.vendorsEnabled",
                  "Allow vendor accounts",
                )}
              </Label>
              <Switch
                id="ai-access-vendors"
                checked={ai.access?.vendorsEnabled !== false}
                onCheckedChange={(checked) =>
                  updateNestedField(
                    "aiAuthoring.access.vendorsEnabled",
                    checked,
                  )
                }
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-limit-text">
                {tSafe(
                  "admin.settings.ai.textLimit",
                  "Text generations / user / day",
                )}
              </Label>
              <NumberInput
                id="ai-limit-text"
                min={0}
                max={100000}
                step={1}
                value={ai.limits?.textPerUserPerDay ?? 0}
                whenEmpty={0}
                normalize={Math.trunc}
                onValueChange={(next) =>
                  updateNestedField("aiAuthoring.limits.textPerUserPerDay", next ?? 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-limit-image">
                {tSafe(
                  "admin.settings.ai.imageLimit",
                  "Image generations / user / day",
                )}
              </Label>
              <NumberInput
                id="ai-limit-image"
                min={0}
                max={100000}
                step={1}
                value={ai.limits?.imagePerUserPerDay ?? 0}
                whenEmpty={0}
                normalize={Math.trunc}
                onValueChange={(next) =>
                  updateNestedField("aiAuthoring.limits.imagePerUserPerDay", next ?? 0)
                }
              />
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.ai.imageLimitHint",
                  "Images cost the most — set a cap for shared stores.",
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <StickySaveFooter
        label={tSafe("admin.settings.saveChanges", "Save Changes")}
        isSaving={isSaving}
        isDirty={isDirty}
        onSave={onSave}
      />
    </div>
  );
}
