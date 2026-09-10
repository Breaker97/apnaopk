"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast-notification";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";

interface CustomerProfile {
  emailNotifications?: {
    orderUpdates?: boolean;
    promotions?: boolean;
    newsletter?: boolean;
    priceDrops?: boolean;
    backInStock?: boolean;
  };
  marketingOptIn?: boolean;
  preferredPaymentMethod?: string;
  preferredCurrency?: string;
  preferredLanguage?: string;
}

export function PreferencesForm() {
  const t = useTranslations();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile>({});

  const fetchProfile = useCallback(
    () =>
      fetch("/api/user/customer-profile")
        .then((res) => res.json())
        .then((json) => {
          if (json.success && json.data?.profile) setProfile(json.data.profile);
        })
        .catch((error) => {
          console.error("Failed to fetch profile:", error);
        })
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/customer-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketingOptIn: profile.marketingOptIn,
          emailNotifications: profile.emailNotifications,
          preferredPaymentMethod: profile.preferredPaymentMethod,
          preferredCurrency: profile.preferredCurrency,
          preferredLanguage: profile.preferredLanguage,
        }),
      });

      const json = await res.json();
      if (json.success) {
        toast.success(t("customerProfile.preferencesSaved"));
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

  const updateNotification = (
    key: keyof NonNullable<CustomerProfile["emailNotifications"]>,
    value: boolean,
  ) => {
    setProfile((prev) => ({
      ...prev,
      emailNotifications: {
        ...prev.emailNotifications,
        [key]: value,
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title-less on purpose: the page header above already reads
          "Preferences", so this bar only keeps Save in reach while scrolling. */}
      <AdminFormStickyHeader
        actions={
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t("common.save")}
          </Button>
        }
      />

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>{t("customerProfile.emailNotifications")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("customerProfile.orderUpdates")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("customerProfile.orderUpdatesDesc")}
              </p>
            </div>
            <Switch
              checked={profile.emailNotifications?.orderUpdates ?? true}
              onCheckedChange={(val) => updateNotification("orderUpdates", val)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("customerProfile.promotions")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("customerProfile.promotionsDesc")}
              </p>
            </div>
            <Switch
              checked={profile.emailNotifications?.promotions ?? false}
              onCheckedChange={(val) => updateNotification("promotions", val)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("customerProfile.newsletter")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("customerProfile.newsletterDesc")}
              </p>
            </div>
            <Switch
              checked={profile.emailNotifications?.newsletter ?? false}
              onCheckedChange={(val) => updateNotification("newsletter", val)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("customerProfile.priceDrops")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("customerProfile.priceDropsDesc")}
              </p>
            </div>
            <Switch
              checked={profile.emailNotifications?.priceDrops ?? false}
              onCheckedChange={(val) => updateNotification("priceDrops", val)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("customerProfile.backInStock")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("customerProfile.backInStockDesc")}
              </p>
            </div>
            <Switch
              checked={profile.emailNotifications?.backInStock ?? false}
              onCheckedChange={(val) => updateNotification("backInStock", val)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Marketing Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>{t("customerProfile.marketingPreferences")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("customerProfile.marketingOptIn")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("customerProfile.marketingOptInDesc")}
              </p>
            </div>
            <Switch
              checked={profile.marketingOptIn ?? false}
              onCheckedChange={(val) =>
                setProfile((prev) => ({ ...prev, marketingOptIn: val }))
              }
            />
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
