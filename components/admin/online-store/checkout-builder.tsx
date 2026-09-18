"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ExternalLink,
  GripVertical,
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
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import {
  FieldRow,
  SwitchRow,
} from "@/components/admin/online-store/builder-fields";
import { CheckoutBuilderSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import {
  ABANDONED_RECOVERY_DELAYS,
  CHECKOUT_CUSTOM_FIELD_PLACEMENTS,
  CHECKOUT_CUSTOM_FIELD_TYPES,
  CHECKOUT_HELP_MAX,
  CHECKOUT_LABEL_MAX,
  CONFIGURABLE_ADDRESS_FIELDS,
  LOCKED_ADDRESS_FIELDS,
  MAX_CHECKOUT_CUSTOM_FIELDS,
  MAX_CHECKOUT_POLICY_LINKS,
  contactModeCollects,
  createCheckoutCustomFieldId,
  getDefaultCheckoutSettings,
  normalizeCheckoutSettings,
  type CheckoutChromeMode,
  type CheckoutContactMode,
  type CheckoutCustomField,
  type CheckoutCustomFieldPlacement,
  type CheckoutCustomFieldType,
  type CheckoutFieldVisibility,
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

type Translate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

function cloneCheckout(value: CheckoutSettings): CheckoutSettings {
  return JSON.parse(JSON.stringify(value)) as CheckoutSettings;
}

const TAB_TRIGGER_CLASS =
  "rounded-lg px-4 font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

/**
 * The checkout editor. Checkout is never sectionized — the step order is
 * locked so payments never break — but everything inside the steps is the
 * admin's: how shoppers are contacted, which address fields are asked for
 * and required, extra questions of the store's own, accounts, abandoned
 * checkout recovery, and the chrome/trust copy around it all. The payment
 * routes enforce the same settings (lib/checkout/checkout-form-policy.ts).
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
          "intro",
          "Choose what checkout asks for and how it looks. The steps keep their order, so payments never break.",
        )}
      </p>

      <Tabs defaultValue="form" className="gap-6">
        <div className="overflow-x-auto">
          <TabsList className="h-11 gap-1 rounded-xl border border-border bg-background p-1 shadow-sm">
            <TabsTrigger value="form" className={TAB_TRIGGER_CLASS}>
              {tf("tabs.form", "Form fields")}
            </TabsTrigger>
            <TabsTrigger value="accounts" className={TAB_TRIGGER_CLASS}>
              {tf("tabs.accounts", "Customer accounts")}
            </TabsTrigger>
            <TabsTrigger value="abandoned" className={TAB_TRIGGER_CLASS}>
              {tf("tabs.abandoned", "Abandoned checkouts")}
            </TabsTrigger>
            <TabsTrigger value="appearance" className={TAB_TRIGGER_CLASS}>
              {tf("tabs.appearance", "Appearance")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="form" className="space-y-6">
          <ContactCard checkout={checkout} update={update} tf={tf} />
          <AddressFieldsCard checkout={checkout} update={update} tf={tf} />
          <CustomFieldsCard checkout={checkout} update={update} tf={tf} />
          <OrderNoteCard checkout={checkout} update={update} tf={tf} />
        </TabsContent>

        <TabsContent value="accounts" className="space-y-6">
          <AccountsCard checkout={checkout} update={update} tf={tf} />
        </TabsContent>

        <TabsContent value="abandoned" className="space-y-6">
          <AbandonedCard
            checkout={checkout}
            update={update}
            tf={tf}
            locale={locale}
          />
        </TabsContent>

        <TabsContent value="appearance" className="space-y-6">
          <AppearanceCards
            checkout={checkout}
            update={update}
            tf={tf}
            locale={locale}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface SectionProps {
  checkout: CheckoutSettings;
  update: (mutate: (draft: CheckoutSettings) => void) => void;
  tf: Translate;
}

function visibilityOptions(tf: Translate) {
  return [
    { value: "required", label: tf("visibility.required", "Required") },
    { value: "optional", label: tf("visibility.optional", "Optional") },
    { value: "hidden", label: tf("visibility.hidden", "Hidden") },
  ] as const;
}

function VisibilitySelect({
  value,
  onChange,
  tf,
  className,
  ariaLabel,
}: {
  value: CheckoutFieldVisibility;
  onChange: (value: CheckoutFieldVisibility) => void;
  tf: Translate;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <NativeSelect
      value={value}
      aria-label={ariaLabel}
      onChange={(event) =>
        onChange(event.target.value as CheckoutFieldVisibility)
      }
      className={cn("w-32 shrink-0", className)}
    >
      {visibilityOptions(tf).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function Hint({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        warn ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      {warn ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Contact                                                             */
/* ------------------------------------------------------------------ */

function ContactCard({ checkout, update, tf }: SectionProps) {
  const modes: { value: CheckoutContactMode; label: string; hint: string }[] = [
    {
      value: "email",
      label: tf("contact.modes.email", "Email"),
      hint: tf("contact.modes.emailHint", "Receipts and updates by email."),
    },
    {
      value: "phone",
      label: tf("contact.modes.phone", "Phone"),
      hint: tf(
        "contact.modes.phoneHint",
        "No email asked. Updates by SMS; orders are tracked by phone.",
      ),
    },
    {
      value: "email_or_phone",
      label: tf("contact.modes.emailOrPhone", "Email or phone"),
      hint: tf("contact.modes.emailOrPhoneHint", "The shopper gives either one."),
    },
    {
      value: "email_and_phone",
      label: tf("contact.modes.emailAndPhone", "Email and phone"),
      hint: tf("contact.modes.emailAndPhoneHint", "Both are required."),
    },
  ];
  const collects = contactModeCollects(checkout.contact.mode);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tf("contact.title", "Contact")}</CardTitle>
        <CardDescription>
          {tf(
            "contact.description",
            "How shoppers are reached about their order.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="radiogroup"
          aria-label={tf("contact.title", "Contact")}
          className="grid gap-2 sm:grid-cols-2"
        >
          {modes.map((mode) => {
            const active = checkout.contact.mode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() =>
                  update((draft) => {
                    draft.contact.mode = mode.value;
                  })
                }
                className={cn(
                  "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-accent/40",
                )}
              >
                <span className="text-sm font-semibold">{mode.label}</span>
                <span className="text-xs text-muted-foreground">{mode.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {collects.email ? (
            <FieldRow label={tf("contact.emailLabel", "Email field label")}>
              <Input
                value={checkout.contact.emailLabel}
                maxLength={CHECKOUT_LABEL_MAX}
                placeholder={tf("contact.emailPlaceholder", "Email")}
                onChange={(event) =>
                  update((draft) => {
                    draft.contact.emailLabel = event.target.value;
                  })
                }
              />
            </FieldRow>
          ) : null}
          {collects.phone ? (
            <FieldRow label={tf("contact.phoneLabel", "Phone field label")}>
              <Input
                value={checkout.contact.phoneLabel}
                maxLength={CHECKOUT_LABEL_MAX}
                placeholder={tf("contact.phonePlaceholder", "Phone")}
                onChange={(event) =>
                  update((draft) => {
                    draft.contact.phoneLabel = event.target.value;
                  })
                }
              />
            </FieldRow>
          ) : null}
        </div>
        {checkout.contact.mode !== "email" ? (
          <Hint>
            {tf(
              "contact.phoneModeHint",
              "Paystack, Pesapal, Orange Money and ioTec card payments still ask for an email — checkout requests it inside that payment option.",
            )}
          </Hint>
        ) : null}

        <div className="space-y-3 rounded-lg border p-3">
          <SwitchRow
            label={tf("contact.marketing", "Show the news & offers checkbox")}
            checked={checkout.contact.marketingOptIn.enabled}
            onChange={(value) =>
              update((draft) => {
                draft.contact.marketingOptIn.enabled = value;
              })
            }
          />
          {checkout.contact.marketingOptIn.enabled ? (
            <>
              <FieldRow label={tf("contact.marketingLabel", "Checkbox text")}>
                <Input
                  value={checkout.contact.marketingOptIn.label}
                  placeholder={tf(
                    "contact.marketingPlaceholder",
                    "Email me with news and offers",
                  )}
                  onChange={(event) =>
                    update((draft) => {
                      draft.contact.marketingOptIn.label = event.target.value;
                    })
                  }
                />
              </FieldRow>
              <SwitchRow
                label={tf("contact.marketingDefault", "Pre-tick the checkbox")}
                checked={checkout.contact.marketingOptIn.defaultChecked}
                onChange={(value) =>
                  update((draft) => {
                    draft.contact.marketingOptIn.defaultChecked = value;
                  })
                }
              />
              {checkout.contact.marketingOptIn.defaultChecked ? (
                <Hint warn>
                  {tf(
                    "contact.marketingDefaultWarn",
                    "In many countries (the EU and UK among them) marketing consent must be opt-in, not pre-ticked.",
                  )}
                </Hint>
              ) : null}
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Built-in address fields                                             */
/* ------------------------------------------------------------------ */

function AddressFieldsCard({ checkout, update, tf }: SectionProps) {
  const names: Record<
    (typeof CONFIGURABLE_ADDRESS_FIELDS)[number] | (typeof LOCKED_ADDRESS_FIELDS)[number],
    string
  > = {
    country: tf("fields.country", "Country"),
    firstName: tf("fields.firstName", "First name"),
    lastName: tf("fields.lastName", "Last name"),
    address: tf("fields.address", "Street address"),
    apartment: tf("fields.apartment", "Apartment, suite, etc."),
    city: tf("fields.city", "City"),
    postalCode: tf("fields.postalCode", "Postal code"),
    state: tf("fields.state", "State / region"),
    phone: tf("fields.phone", "Delivery phone"),
  };
  // The storefront's own order, locked and configurable interleaved.
  const order = [
    "country",
    "firstName",
    "lastName",
    "address",
    "apartment",
    "city",
    "postalCode",
    "state",
    "phone",
  ] as const;
  const locked = new Set<string>(LOCKED_ADDRESS_FIELDS);
  const bothNamesOptional =
    checkout.fields.firstName.visibility !== "required" &&
    checkout.fields.lastName.visibility !== "required";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tf("fields.title", "Address fields")}</CardTitle>
        <CardDescription>
          {tf(
            "fields.description",
            "Rename any field, and choose whether it is required, optional or hidden. Applies to the delivery and the billing address. Leave a label empty to use the translated default.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {order.map((key) => {
          const isLocked = locked.has(key);
          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center"
            >
              <span className="text-sm font-medium sm:w-44 sm:shrink-0">
                {names[key]}
              </span>
              <Input
                value={checkout.fields[key].label}
                maxLength={CHECKOUT_LABEL_MAX}
                placeholder={names[key]}
                aria-label={`${names[key]} — ${tf("fields.label", "label")}`}
                className="sm:flex-1"
                onChange={(event) =>
                  update((draft) => {
                    draft.fields[key].label = event.target.value;
                  })
                }
              />
              {isLocked ? (
                <span className="flex w-32 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  {tf("fields.alwaysRequired", "Always required")}
                </span>
              ) : (
                <VisibilitySelect
                  tf={tf}
                  ariaLabel={`${names[key]} — ${tf("fields.visibility", "visibility")}`}
                  value={
                    checkout.fields[key as (typeof CONFIGURABLE_ADDRESS_FIELDS)[number]]
                      .visibility
                  }
                  onChange={(value) =>
                    update((draft) => {
                      draft.fields[
                        key as (typeof CONFIGURABLE_ADDRESS_FIELDS)[number]
                      ].visibility = value;
                    })
                  }
                />
              )}
            </div>
          );
        })}
        <div className="space-y-1 pt-2">
          <Hint>
            {tf(
              "fields.lockedHint",
              "Country, street and city stay required — shipping is priced from them and a courier cannot deliver without them.",
            )}
          </Hint>
          {bothNamesOptional ? (
            <Hint warn>
              {tf(
                "fields.nameWarn",
                "An order needs a recipient name, so the last name will be saved as required.",
              )}
            </Hint>
          ) : null}
          {checkout.fields.state.visibility === "hidden" ? (
            <Hint warn>
              {tf(
                "fields.stateWarn",
                "Shipping zones that price by state or region cannot match an address without one.",
              )}
            </Hint>
          ) : null}
          {checkout.fields.postalCode.visibility !== "required" ? (
            <Hint warn>
              {tf(
                "fields.postalWarn",
                "Some couriers (Shiprocket, Shippo) need a postal code to book a shipment.",
              )}
            </Hint>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Custom fields                                                       */
/* ------------------------------------------------------------------ */

function CustomFieldsCard({ checkout, update, tf }: SectionProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    update((draft) => {
      const from = draft.customFields.findIndex((field) => field.id === active.id);
      const to = draft.customFields.findIndex((field) => field.id === over.id);
      if (from < 0 || to < 0) return;
      draft.customFields = arrayMove(draft.customFields, from, to);
    });
  };

  const addField = () =>
    update((draft) => {
      draft.customFields.push({
        id: createCheckoutCustomFieldId(),
        label: "",
        type: "text",
        placement: "additional",
        visibility: "optional",
        placeholder: "",
        helpText: "",
        options: [],
      });
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tf("custom.title", "Custom fields")}</CardTitle>
        <CardDescription>
          {tf(
            "custom.description",
            "Ask for anything else — a delivery time, a gift message, a tax ID. Answers are saved on the order and shown to you, the vendor and the customer.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {checkout.customFields.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {tf("custom.empty", "No custom fields yet.")}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={checkout.customFields.map((field) => field.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {checkout.customFields.map((field, index) => (
                  <CustomFieldRow
                    key={field.id}
                    field={field}
                    tf={tf}
                    onPatch={(patch) =>
                      update((draft) => {
                        draft.customFields[index] = {
                          ...draft.customFields[index],
                          ...patch,
                        };
                      })
                    }
                    onRemove={() =>
                      update((draft) => {
                        draft.customFields.splice(index, 1);
                      })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={checkout.customFields.length >= MAX_CHECKOUT_CUSTOM_FIELDS}
          onClick={addField}
        >
          <Plus className="mr-2 h-4 w-4" />
          {tf("custom.add", "Add field")}
        </Button>
        <Hint>
          {tf(
            "custom.hint",
            "Fields without a label, and dropdowns without options, are dropped on save. Delivery fields are skipped for download-only orders.",
          )}
        </Hint>
      </CardContent>
    </Card>
  );
}

function CustomFieldRow({
  field,
  tf,
  onPatch,
  onRemove,
}: {
  field: CheckoutCustomField;
  tf: Translate;
  onPatch: (patch: Partial<CheckoutCustomField>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const typeLabels: Record<CheckoutCustomFieldType, string> = {
    text: tf("custom.types.text", "Short text"),
    textarea: tf("custom.types.textarea", "Long text"),
    number: tf("custom.types.number", "Number"),
    email: tf("custom.types.email", "Email"),
    phone: tf("custom.types.phone", "Phone"),
    date: tf("custom.types.date", "Date"),
    select: tf("custom.types.select", "Dropdown"),
    checkbox: tf("custom.types.checkbox", "Checkbox"),
  };
  const placementLabels: Record<CheckoutCustomFieldPlacement, string> = {
    contact: tf("custom.placements.contact", "Contact step"),
    delivery: tf("custom.placements.delivery", "Delivery step"),
    additional: tf("custom.placements.additional", "Before payment"),
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground"
          aria-label={tf("custom.drag", "Drag to reorder")}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={field.label}
          maxLength={CHECKOUT_LABEL_MAX}
          placeholder={tf("custom.labelPlaceholder", "Field label, e.g. Gift message")}
          aria-label={tf("custom.label", "Field label")}
          className={cn("h-9 min-w-40 flex-1", !field.label.trim() && "border-amber-500/60")}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
        <NativeSelect
          value={field.type}
          aria-label={tf("custom.type", "Field type")}
          className="w-32 shrink-0"
          onChange={(event) =>
            onPatch({ type: event.target.value as CheckoutCustomFieldType })
          }
        >
          {CHECKOUT_CUSTOM_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {typeLabels[type]}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tf("custom.remove", "Remove field")}
          className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 grid gap-3 pl-6 sm:grid-cols-2">
        <FieldRow label={tf("custom.placement", "Shown in")}>
          <NativeSelect
            value={field.placement}
            className="w-full"
            onChange={(event) =>
              onPatch({
                placement: event.target.value as CheckoutCustomFieldPlacement,
              })
            }
          >
            {CHECKOUT_CUSTOM_FIELD_PLACEMENTS.map((placement) => (
              <option key={placement} value={placement}>
                {placementLabels[placement]}
              </option>
            ))}
          </NativeSelect>
        </FieldRow>
        <FieldRow label={tf("custom.visibility", "Visibility")}>
          <VisibilitySelect
            tf={tf}
            className="w-full"
            ariaLabel={tf("custom.visibility", "Visibility")}
            value={field.visibility}
            onChange={(visibility) => onPatch({ visibility })}
          />
        </FieldRow>
        {field.type !== "checkbox" && field.type !== "date" ? (
          <FieldRow label={tf("custom.placeholder", "Placeholder")}>
            <Input
              value={field.placeholder}
              maxLength={CHECKOUT_LABEL_MAX}
              onChange={(event) => onPatch({ placeholder: event.target.value })}
            />
          </FieldRow>
        ) : null}
        <FieldRow label={tf("custom.helpText", "Help text")}>
          <Input
            value={field.helpText}
            maxLength={CHECKOUT_HELP_MAX}
            onChange={(event) => onPatch({ helpText: event.target.value })}
          />
        </FieldRow>
        {field.type === "select" ? (
          <div className="sm:col-span-2">
            <FieldRow label={tf("custom.options", "Options (one per line)")}>
              <Textarea
                rows={4}
                value={field.options.join("\n")}
                placeholder={"Morning\nAfternoon\nEvening"}
                onChange={(event) =>
                  onPatch({ options: event.target.value.split("\n") })
                }
              />
            </FieldRow>
          </div>
        ) : null}
        {field.type === "checkbox" && field.visibility === "required" ? (
          <div className="sm:col-span-2">
            <Hint>
              {tf(
                "custom.requiredCheckboxHint",
                "A required checkbox must be ticked to order — useful for “I agree to …”.",
              )}
            </Hint>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Order note                                                          */
/* ------------------------------------------------------------------ */

function OrderNoteCard({ checkout, update, tf }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tf("orderNote.title", "Order note")}</CardTitle>
        <CardDescription>
          {tf(
            "orderNote.description",
            "A free-text box for delivery instructions or special requests.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
          <Label className="m-0">{tf("orderNote.visibility", "Order note box")}</Label>
          <VisibilitySelect
            tf={tf}
            ariaLabel={tf("orderNote.visibility", "Order note box")}
            value={checkout.orderNote.visibility}
            onChange={(visibility) =>
              update((draft) => {
                draft.orderNote.visibility = visibility;
              })
            }
          />
        </div>
        {checkout.orderNote.visibility !== "hidden" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label={tf("orderNote.label", "Label")}>
              <Input
                value={checkout.orderNote.label}
                maxLength={CHECKOUT_LABEL_MAX}
                placeholder={tf("orderNote.labelPlaceholder", "Order note")}
                onChange={(event) =>
                  update((draft) => {
                    draft.orderNote.label = event.target.value;
                  })
                }
              />
            </FieldRow>
            <FieldRow label={tf("orderNote.placeholder", "Placeholder")}>
              <Input
                value={checkout.orderNote.placeholder}
                maxLength={CHECKOUT_HELP_MAX}
                placeholder={tf(
                  "orderNote.placeholderPlaceholder",
                  "Special instructions for your order",
                )}
                onChange={(event) =>
                  update((draft) => {
                    draft.orderNote.placeholder = event.target.value;
                  })
                }
              />
            </FieldRow>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

function AccountsCard({ checkout, update, tf }: SectionProps) {
  const phoneOnly = !contactModeCollects(checkout.contact.mode).email;
  const { guestCheckout, signupAtCheckout } = checkout.accounts;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tf("accounts.title", "Customer accounts")}</CardTitle>
        <CardDescription>
          {tf(
            "accounts.description",
            "Whether shoppers can order as guests, and whether checkout can create an account for them.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <SwitchRow
            label={tf("accounts.guestCheckout", "Allow guest checkout")}
            checked={guestCheckout}
            onChange={(value) =>
              update((draft) => {
                draft.accounts.guestCheckout = value;
              })
            }
          />
          <Hint>
            {tf(
              "accounts.guestCheckoutHint",
              "Off: only signed-in customers can place an order. The payment step refuses guests too.",
            )}
          </Hint>
        </div>

        <div className="space-y-1.5">
          <SwitchRow
            label={tf("accounts.signup", "Let shoppers create an account at checkout")}
            checked={signupAtCheckout && !phoneOnly}
            disabled={phoneOnly}
            onChange={(value) =>
              update((draft) => {
                draft.accounts.signupAtCheckout = value;
              })
            }
          />
          <Hint>
            {phoneOnly
              ? tf(
                  "accounts.signupPhoneOnly",
                  "Accounts sign in by email, so this needs a contact mode that collects an email.",
                )
              : guestCheckout
                ? tf(
                    "accounts.signupOptionalHint",
                    "Guests see a “Create an account” tick-box and choose a password. The order is saved to the new account.",
                  )
                : tf(
                    "accounts.signupRequiredHint",
                    "With guest checkout off, a new shopper creates their account right in checkout instead of leaving to register.",
                  )}
          </Hint>
        </div>

        {!guestCheckout && (!signupAtCheckout || phoneOnly) ? (
          <Hint warn>
            {tf(
              "accounts.loginWallWarn",
              "Shoppers who are not signed in will be asked to log in or register before they see checkout.",
            )}
          </Hint>
        ) : null}
        {signupAtCheckout && !phoneOnly ? (
          <Hint>
            {tf(
              "accounts.verificationHint",
              "If email verification is required (Settings → Security), the account opens after the shopper verifies; the order is linked to it then.",
            )}
          </Hint>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Abandoned checkouts                                                 */
/* ------------------------------------------------------------------ */

function AbandonedCard({
  checkout,
  update,
  tf,
  locale,
}: SectionProps & { locale: string }) {
  const config = checkout.abandonedCheckouts;
  const delayLabel = (minutes: number) =>
    minutes < 60
      ? tf("abandoned.minutes", "{count} minutes", { count: minutes })
      : minutes === 60
        ? tf("abandoned.oneHour", "1 hour")
        : tf("abandoned.hours", "{count} hours", { count: minutes / 60 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tf("abandoned.title", "Abandoned checkouts")}</CardTitle>
        <CardDescription>
          {tf(
            "abandoned.description",
            "Keep checkouts shoppers leave unfinished, and win them back with a recovery email.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <SwitchRow
            label={tf("abandoned.enabled", "Track abandoned checkouts")}
            checked={config.enabled}
            onChange={(value) =>
              update((draft) => {
                draft.abandonedCheckouts.enabled = value;
              })
            }
          />
          <Hint>
            {tf(
              "abandoned.enabledHint",
              "Off: nothing a shopper types at checkout is saved for recovery, and no recovery email is sent.",
            )}
          </Hint>
        </div>

        <div className={cn("space-y-4", !config.enabled && "pointer-events-none opacity-55")}>
          <SwitchRow
            label={tf("abandoned.autoEmail", "Send recovery emails automatically")}
            checked={config.autoRecoveryEmail}
            disabled={!config.enabled}
            onChange={(value) =>
              update((draft) => {
                draft.abandonedCheckouts.autoRecoveryEmail = value;
              })
            }
          />
          {config.autoRecoveryEmail ? (
            <>
              <div className="flex flex-col gap-2 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <Label className="m-0">
                  {tf("abandoned.delay", "Send after the checkout has been idle for")}
                </Label>
                <NativeSelect
                  value={String(config.delayMinutes)}
                  disabled={!config.enabled}
                  className="w-full sm:w-40"
                  onChange={(event) =>
                    update((draft) => {
                      draft.abandonedCheckouts.delayMinutes = Number(event.target.value);
                    })
                  }
                >
                  {(ABANDONED_RECOVERY_DELAYS as readonly number[]).includes(
                    config.delayMinutes,
                  ) ? null : (
                    <option value={config.delayMinutes}>
                      {delayLabel(config.delayMinutes)}
                    </option>
                  )}
                  {ABANDONED_RECOVERY_DELAYS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {delayLabel(minutes)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <SwitchRow
                label={tf(
                  "abandoned.consentOnly",
                  "Only email shoppers who ticked the news & offers box",
                )}
                checked={config.marketingConsentOnly}
                disabled={!config.enabled}
                onChange={(value) =>
                  update((draft) => {
                    draft.abandonedCheckouts.marketingConsentOnly = value;
                  })
                }
              />
              <Hint>
                {tf(
                  "abandoned.autoEmailHint",
                  "One email per checkout, with a link that restores the cart. Needs working email (Settings → Email) and the scheduled job /api/cron/abandoned-checkouts running.",
                )}
              </Hint>
              {config.marketingConsentOnly &&
              !checkout.contact.marketingOptIn.enabled ? (
                <Hint warn>
                  {tf(
                    "abandoned.consentWarn",
                    "The news & offers checkbox is switched off on the Form fields tab, so no shopper can consent and no email will go out.",
                  )}
                </Hint>
              ) : null}
            </>
          ) : (
            <Hint>
              {tf(
                "abandoned.manualHint",
                "You can still send a recovery email by hand from the abandoned checkouts list.",
              )}
            </Hint>
          )}
        </div>

        <Button variant="outline" size="sm" asChild>
          <Link href={`/${locale}/admin/abandoned-checkouts`}>
            {tf("abandoned.viewList", "View abandoned checkouts")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Appearance: chrome, trust copy, policy links                        */
/* ------------------------------------------------------------------ */

function AppearanceCards({
  checkout,
  update,
  tf,
  locale,
}: SectionProps & { locale: string }) {
  return (
    <>
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

      {/* Where the rest lives — logo and colors are never set here */}
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
    </>
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
