"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-notification";
import { StickySaveFooter } from "@/components/admin/settings/sections/sticky-save-footer";
import { useSuspenseResource } from "@/hooks/use-suspense-resource";
import { cn } from "@/lib/utils";

interface CustomerProfile {
  emailNotifications?: {
    orderUpdates?: boolean;
    promotions?: boolean;
    newsletter?: boolean;
    priceDrops?: boolean;
    backInStock?: boolean;
  };
  smsNotifications?: {
    orderUpdates?: boolean;
  };
  marketingOptIn?: boolean;
  preferredPaymentMethod?: string;
  preferredCurrency?: string;
  preferredLanguage?: string;
}

interface CustomerProfileResponse {
  profile?: CustomerProfile;
  smsUpdatesAvailable?: boolean;
}

/** Every switch on the page, with the default a never-saved profile shows. */
interface Draft {
  orderUpdates: boolean;
  smsOrderUpdates: boolean;
  priceDrops: boolean;
  backInStock: boolean;
  marketingOptIn: boolean;
  promotions: boolean;
  newsletter: boolean;
}

function toDraft(profile: CustomerProfile | undefined): Draft {
  return {
    orderUpdates: profile?.emailNotifications?.orderUpdates ?? true,
    smsOrderUpdates: profile?.smsNotifications?.orderUpdates ?? true,
    priceDrops: profile?.emailNotifications?.priceDrops ?? false,
    backInStock: profile?.emailNotifications?.backInStock ?? false,
    marketingOptIn: profile?.marketingOptIn ?? false,
    promotions: profile?.emailNotifications?.promotions ?? false,
    newsletter: profile?.emailNotifications?.newsletter ?? false,
  };
}

/**
 * Suspends until the saved preferences are known — render it inside
 * `<ClientSuspense>`. A later visit starts from the held copy, which a save
 * keeps current, so it makes no request.
 */
export function PreferencesForm() {
  const t = useTranslations();
  const { data, error, mutate } = useSuspenseResource<CustomerProfileResponse>(
    "/api/user/customer-profile",
  );
  useEffect(() => {
    if (error) console.error("Failed to fetch profile:", error);
  }, [error]);
  const [saving, setSaving] = useState(false);
  // The switches edit a local draft; Save writes it. Seeded once, so a
  // background refresh of the held copy never flips a switch mid-edit.
  const [saved, setSaved] = useState<Draft>(() => toDraft(data?.profile));
  const [draft, setDraft] = useState<Draft>(saved);
  const smsUpdatesAvailable = data?.smsUpdatesAvailable === true;
  const isDirty = (Object.keys(draft) as (keyof Draft)[]).some(
    (key) => draft[key] !== saved[key],
  );

  const set = (key: keyof Draft) => (value: boolean) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/customer-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Only a changed consent switch is sent: writing it IS a
          // subscribe or an unsubscribe, so a save that left it alone must
          // not record one.
          ...(draft.marketingOptIn !== saved.marketingOptIn
            ? { marketingOptIn: draft.marketingOptIn }
            : {}),
          emailNotifications: {
            orderUpdates: draft.orderUpdates,
            promotions: draft.promotions,
            newsletter: draft.newsletter,
            priceDrops: draft.priceDrops,
            backInStock: draft.backInStock,
          },
          ...(smsUpdatesAvailable
            ? { smsNotifications: { orderUpdates: draft.smsOrderUpdates } }
            : {}),
          preferredPaymentMethod: data?.profile?.preferredPaymentMethod,
          preferredCurrency: data?.profile?.preferredCurrency,
          preferredLanguage: data?.profile?.preferredLanguage,
        }),
      });

      const json = await res.json();
      if (json.success) {
        toast.success(t("customerProfile.preferencesSaved"));
        setSaved(draft);
        // What the next visit opens with.
        mutate((current) => ({
          ...current,
          profile: {
            ...current.profile,
            marketingOptIn: draft.marketingOptIn,
            emailNotifications: {
              ...current.profile?.emailNotifications,
              orderUpdates: draft.orderUpdates,
              promotions: draft.promotions,
              newsletter: draft.newsletter,
              priceDrops: draft.priceDrops,
              backInStock: draft.backInStock,
            },
            ...(smsUpdatesAvailable
              ? { smsNotifications: { orderUpdates: draft.smsOrderUpdates } }
              : {}),
          },
        }));
      } else {
        throw new Error(json.message || "Failed to save");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save preferences",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* One card, three groups by purpose. Marketing emails is the real
          consent switch; Promotions and Newsletter are topics under it, so
          they are held off while it is off. */}
      <Card className="gap-0 divide-y overflow-hidden py-0">
        <Group title={t("customerProfile.groupOrders")}>
          <Row
            title={t("customerProfile.orderUpdates")}
            description={t("customerProfile.orderUpdatesDesc")}
            checked={draft.orderUpdates}
            onChange={set("orderUpdates")}
          />
          {smsUpdatesAvailable && (
            <Row
              title={t("customerProfile.smsNotifications")}
              description={t("customerProfile.smsOrderUpdatesDesc")}
              checked={draft.smsOrderUpdates}
              onChange={set("smsOrderUpdates")}
            />
          )}
        </Group>

        <Group title={t("customerProfile.groupWishlist")}>
          <Row
            title={t("customerProfile.priceDrops")}
            description={t("customerProfile.priceDropsDesc")}
            checked={draft.priceDrops}
            onChange={set("priceDrops")}
          />
          <Row
            title={t("customerProfile.backInStock")}
            description={t("customerProfile.backInStockDesc")}
            checked={draft.backInStock}
            onChange={set("backInStock")}
          />
        </Group>

        <Group title={t("customerProfile.groupNews")}>
          <Row
            title={t("customerProfile.marketingOptIn")}
            description={t("customerProfile.marketingOptInHint")}
            checked={draft.marketingOptIn}
            onChange={set("marketingOptIn")}
          />
          <Row
            nested
            title={t("customerProfile.promotions")}
            description={t("customerProfile.promotionsDesc")}
            checked={draft.promotions}
            onChange={set("promotions")}
            disabled={!draft.marketingOptIn}
          />
          <Row
            nested
            title={t("customerProfile.newsletter")}
            description={t("customerProfile.newsletterDesc")}
            checked={draft.newsletter}
            onChange={set("newsletter")}
            disabled={!draft.marketingOptIn}
          />
        </Group>
      </Card>

      <StickySaveFooter
        label={t("admin.settings.saveChanges")}
        isSaving={saving}
        isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => setDraft(saved)}
      />
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-6 rtl:tracking-normal">
        {title}
      </h2>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  checked,
  onChange,
  disabled,
  nested,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  nested?: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 px-4 py-4 sm:px-6",
        nested && "ps-8 sm:ps-12",
      )}
    >
      <div className={cn("min-w-0 space-y-0.5", disabled && "opacity-50")}>
        <Label htmlFor={id}>{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
