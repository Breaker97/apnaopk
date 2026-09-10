"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ExternalLink,
  Loader2,
  Lock,
  Palette,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { PageSwitcherSelect } from "@/components/admin/store-pages/page-switcher-select";
import type { PageSwitcher } from "@/lib/storefront/pages/page-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-notification";
import {
  FieldRow,
  SwitchRow,
} from "@/components/admin/online-store/builder-fields";
import { CheckoutBuilderSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import {
  MAX_CHECKOUT_POLICY_LINKS,
  getDefaultCheckoutSettings,
  normalizeCheckoutSettings,
  type CheckoutChromeMode,
  type CheckoutSettings,
} from "@/lib/checkout/checkout-config";
import { cn } from "@/lib/utils";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface CheckoutBuilderProps {
  locale: string;
  /** The storefront editor's page switcher, rendered as this page's title. */
  switcher?: PageSwitcher;
}

type SettingsPayload = {
  success?: boolean;
  data?: { checkout?: unknown };
};

function cloneCheckout(value: CheckoutSettings): CheckoutSettings {
  return JSON.parse(JSON.stringify(value)) as CheckoutSettings;
}

/**
 * The CONSTRAINED checkout editor. Checkout is never sectionized — the flow
 * is locked; admins choose the chrome, the trust copy and the policy links.
 * Logo and colors intentionally live elsewhere (Branding / Theme settings).
 */
export function CheckoutBuilder({ locale, switcher }: CheckoutBuilderProps) {
  const t = useTranslations("admin.checkoutStudio");
  const tf = useFallbackTranslator(t);

  const [checkout, setCheckout] = useState<CheckoutSettings>(() =>
    getDefaultCheckoutSettings(),
  );
  const [initialCheckout, setInitialCheckout] = useState<CheckoutSettings>(
    () => getDefaultCheckoutSettings(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty =
    JSON.stringify(checkout) !== JSON.stringify(initialCheckout);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/admin/settings", { method: "GET" });
        const payload = (await response.json()) as SettingsPayload;
        if (cancelled) return;
        const loaded = normalizeCheckoutSettings(payload.data?.checkout);
        setCheckout(loaded);
        setInitialCheckout(cloneCheckout(loaded));
      } catch {
        // Defaults stay in place; save still works.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (mutate: (draft: CheckoutSettings) => void) => {
    setCheckout((current) => {
      const next = cloneCheckout(current);
      mutate(next);
      return next;
    });
  };

  const save = async () => {
    try {
      setIsSaving(true);
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "checkout",
          data: normalizeCheckoutSettings(checkout),
        }),
      });
      const payload = (await response.json()) as SettingsPayload;
      if (!response.ok || payload.success !== true) {
        throw new Error("save failed");
      }
      const saved = normalizeCheckoutSettings(payload.data?.checkout);
      setCheckout(saved);
      setInitialCheckout(cloneCheckout(saved));
      toast.success(tf("toast.saved", "Checkout settings saved"));
    } catch {
      toast.error(tf("toast.saveFailed", "Could not save checkout settings"));
    } finally {
      setIsSaving(false);
    }
  };

  // The same placeholder `checkout/loading.tsx` paints, so the navigation and
  // the settings fetch read as one load rather than a skeleton then a spinner.
  if (isLoading) return <CheckoutBuilderSkeleton />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={
          switcher ? (
            <PageSwitcherSelect
              switcher={switcher}
              locale={locale}
              variant="title"
            />
          ) : (
            tf("title", "Checkout")
          )
        }
        status={
          <Badge variant={isDirty ? "secondary" : "default"}>
            {isDirty
              ? tf("status.unsaved", "Unsaved changes")
              : tf("status.live", "Live")}
          </Badge>
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || isSaving}
              onClick={() => setCheckout(cloneCheckout(initialCheckout))}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {tf("reset", "Reset")}
            </Button>
            <Button variant="outline" asChild>
              <a
                href={`/${locale}/checkout`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {tf("preview", "Preview")}
              </a>
            </Button>
            <Button
              type="button"
              disabled={!isDirty || isSaving}
              onClick={() => void save()}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {tf("save", "Save")}
            </Button>
          </>
        }
      />

      <p className="text-sm text-muted-foreground">
        {tf(
          "subtitle",
          "Checkout keeps its proven flow — brand it here. The steps themselves cannot be rearranged, so payments never break.",
        )}
      </p>

      {/* Layout */}
      <Card>
        <CardHeader>
          <CardTitle>{tf("layout.title", "Layout")}</CardTitle>
          <CardDescription>
            {tf(
              "layout.description",
              "Choose the chrome around checkout. Focused mode hides the store header, footer and assistant so shoppers stay on the payment.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <ChromeOptionCard
            mode="store"
            active={checkout.layout.chrome === "store"}
            label={tf("layout.store", "Store header & footer")}
            description={tf(
              "layout.storeHint",
              "Checkout renders inside the normal storefront chrome.",
            )}
            onSelect={() =>
              update((draft) => {
                draft.layout.chrome = "store";
              })
            }
          />
          <ChromeOptionCard
            mode="focused"
            active={checkout.layout.chrome === "focused"}
            label={tf("layout.focused", "Focused checkout")}
            description={tf(
              "layout.focusedHint",
              "A minimal bar with your logo and a secure badge — no distractions.",
            )}
            onSelect={() =>
              update((draft) => {
                draft.layout.chrome = "focused";
              })
            }
          />
        </CardContent>
      </Card>

      {/* Trust */}
      <Card>
        <CardHeader>
          <CardTitle>{tf("trust.title", "Trust & reassurance")}</CardTitle>
          <CardDescription>
            {tf(
              "trust.description",
              "The copy shoppers read right before they pay.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldRow label={tf("trust.message", "Trust message")}>
            <Input
              value={checkout.trust.message}
              placeholder={tf(
                "trust.messagePlaceholder",
                "All transactions are secure and encrypted.",
              )}
              onChange={(event) =>
                update((draft) => {
                  draft.trust.message = event.target.value;
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              {tf(
                "trust.messageHint",
                "Shown under the payment step. Leave empty to use the built-in translated line.",
              )}
            </p>
          </FieldRow>
          <SwitchRow
            label={tf("trust.showSecureBadge", "Show secure badge")}
            checked={checkout.trust.showSecureBadge}
            onChange={(value) =>
              update((draft) => {
                draft.trust.showSecureBadge = value;
              })
            }
          />
          <FieldRow label={tf("trust.supportText", "Support line")}>
            <Input
              value={checkout.trust.supportText}
              placeholder={tf(
                "trust.supportPlaceholder",
                "Questions? Email support@yourstore.com",
              )}
              onChange={(event) =>
                update((draft) => {
                  draft.trust.supportText = event.target.value;
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              {tf(
                "trust.supportHint",
                "Optional help line under the pay button. Leave empty to hide.",
              )}
            </p>
          </FieldRow>
        </CardContent>
      </Card>

      {/* Policy links */}
      <Card>
        <CardHeader>
          <CardTitle>{tf("policies.title", "Policy links")}</CardTitle>
          <CardDescription>
            {tf(
              "policies.description",
              "Small links under the pay button — refunds, privacy, terms. Relative paths stay inside the store.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checkout.policyLinks.map((link, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center"
            >
              <Input
                value={link.label}
                placeholder={tf("policies.labelPlaceholder", "Refund policy")}
                aria-label={tf("policies.linkLabel", "Link label")}
                className="sm:flex-1"
                onChange={(event) =>
                  update((draft) => {
                    draft.policyLinks[index].label = event.target.value;
                  })
                }
              />
              <Input
                value={link.href}
                placeholder="/returns"
                aria-label={tf("policies.linkUrl", "Link URL")}
                className="sm:flex-1"
                onChange={(event) =>
                  update((draft) => {
                    draft.policyLinks[index].href = event.target.value;
                  })
                }
              />
              <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-start">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={link.visible}
                    aria-label={tf("policies.visible", "Visible")}
                    onCheckedChange={(value) =>
                      update((draft) => {
                        draft.policyLinks[index].visible = value;
                      })
                    }
                  />
                  <Label className="m-0 text-xs text-muted-foreground sm:hidden">
                    {tf("policies.visible", "Visible")}
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tf("policies.remove", "Remove link")}
                  className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                  onClick={() =>
                    update((draft) => {
                      draft.policyLinks.splice(index, 1);
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checkout.policyLinks.length >= MAX_CHECKOUT_POLICY_LINKS}
            onClick={() =>
              update((draft) => {
                draft.policyLinks.push({ label: "", href: "", visible: true });
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            {tf("policies.add", "Add link")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {tf(
              "policies.hint",
              "Links without a label or URL are dropped on save.",
            )}
          </p>
        </CardContent>
      </Card>

      {/* Where the rest lives — the constraint made visible */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Palette className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {tf(
                "brandNote",
                "Checkout reuses your store logo and theme colors automatically, so it can never drift off-brand.",
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${locale}/admin/online-store/theme?tab=branding`}>
                {tf("brandingLink", "Branding")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${locale}/admin/online-store/theme`}>
                {tf("themeLink", "Theme settings")}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Mini diagram card for the two chrome modes, in the header-preset style. */
function ChromeOptionCard({
  mode,
  active,
  label,
  description,
  onSelect,
}: {
  mode: CheckoutChromeMode;
  active: boolean;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-accent/40",
      )}
    >
      <span className="overflow-hidden rounded-md border border-border/70 bg-muted/40">
        {mode === "store" ? (
          <span className="flex h-24 flex-col gap-1 p-1.5">
            <span className="h-3 rounded-sm bg-foreground/25" />
            <span className="flex flex-1 gap-1">
              <span className="flex-1 rounded-sm bg-background" />
              <span className="w-1/3 rounded-sm bg-foreground/10" />
            </span>
            <span className="h-3 rounded-sm bg-foreground/25" />
          </span>
        ) : (
          <span className="flex h-24 flex-col gap-1 p-1.5">
            <span className="flex h-2.5 items-center justify-between rounded-sm bg-foreground/10 px-1">
              <span className="h-1 w-6 rounded-full bg-foreground/40" />
              <Lock className="h-1.5 w-1.5 text-foreground/40" />
            </span>
            <span className="flex flex-1 gap-1">
              <span className="flex-1 rounded-sm bg-background" />
              <span className="w-1/3 rounded-sm bg-foreground/10" />
            </span>
          </span>
        )}
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
