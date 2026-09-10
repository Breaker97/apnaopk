"use client";

import { useEffect, useMemo, useState } from "react";
import { useMessages, useTranslations } from "next-intl";
import {
  Store,
  CreditCard,
  Bell,
  User,
  Loader2,
  Lock,
  Save,
  Share2,
  Truck,
  MessagesSquare,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { MediaUploader } from "@/components/ui/media-uploader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast-notification";
import { authClient } from "@/lib/auth/auth-client";
import { TwoFactorManagementCard } from "@/components/account/two-factor-management-card";
import {
  VendorShippingEditor,
  EMPTY_VENDOR_SHIPPING,
  EMPTY_PLATFORM_SHIPPING,
  type PlatformShippingSummary,
} from "@/components/vendor/vendor-shipping-settings";
import {
  EMPTY_VENDOR_CARRIER_VIEW,
  VendorCarrierAccountCard,
  type VendorCarrierDraft,
  type VendorCarrierView,
} from "@/components/vendor/vendor-carrier-account-card";
import { VendorShareSettings } from "@/components/vendor/vendor-share-settings";
import { VendorSocialProfilesEditor } from "@/components/vendor/vendor-social-profiles-editor";
import type { SocialProfile } from "@/lib/site-config/social-profiles";
import type { VendorShippingProfile } from "@/types";
import {
  DEFAULT_SHARE_SETTINGS,
  type ShareSettings,
} from "@/lib/site-config/share-config";
import {
  DEFAULT_VENDOR_STORE_VISIBILITY,
  VENDOR_ADDRESS_DISPLAY,
  formatVendorAddress,
  type VendorAddressDisplay,
  type VendorStoreVisibility,
} from "@/lib/vendors/vendor-address";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PROFILE_DEMO_MODE,
  normalizeDemoModeState,
  type DemoModeState,
} from "@/lib/demo-mode-shared";
import {
  DEFAULT_VENDOR_MESSAGING,
  type VendorMessagingSettings,
} from "@/lib/notifications/vendor-messaging";
import { ChannelConnectionsPanel } from "@/components/chat/channel-connections-panel";
import { CountrySelect } from "@/components/common/country-multi-select";

type SettingsTab =
  | "store"
  | "payment"
  | "share"
  | "notifications"
  | "account"
  | "shipping"
  | "channels";

const VENDOR_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
const VENDOR_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

interface VendorSettingsState {
  vendor: {
    storeName: string;
    slug: string;
    description: string;
    logo: string;
    banner: string;
    address: {
      street: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
      phone: string;
    };
    socialProfiles: SocialProfile[];
    shareSettings: ShareSettings;
    storeVisibility: VendorStoreVisibility;
    messaging: VendorMessagingSettings;
    bankDetails: {
      accountName: string;
      accountNumber: string;
      bankName: string;
      routingNumber: string;
      swiftCode: string;
    };
    notificationPreferences: {
      newOrders: boolean;
      orderUpdates: boolean;
      lowStock: boolean;
      marketing: boolean;
    };
    payoutSettings: {
      schedule: "weekly" | "biweekly" | "monthly";
      minimumAmount: number;
    };
    shipping?: VendorShippingProfile | null;
  };
  user: {
    name: string;
    email: string;
    phone: string;
    image: string;
  };
}

interface VendorSettingsFormProps {
  initialTab?: string;
  canEdit?: boolean;
  canManageChannels?: boolean;
}

const DEFAULT_SETTINGS: VendorSettingsState = {
  vendor: {
    storeName: "",
    slug: "",
    description: "",
    logo: "",
    banner: "",
    address: {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      phone: "",
    },
    socialProfiles: [],
    shareSettings: DEFAULT_SHARE_SETTINGS,
    storeVisibility: DEFAULT_VENDOR_STORE_VISIBILITY,
    messaging: DEFAULT_VENDOR_MESSAGING,
    bankDetails: {
      accountName: "",
      accountNumber: "",
      bankName: "",
      routingNumber: "",
      swiftCode: "",
    },
    notificationPreferences: {
      newOrders: true,
      orderUpdates: true,
      lowStock: true,
      marketing: false,
    },
    payoutSettings: {
      schedule: "weekly",
      minimumAmount: 0,
    },
    shipping: null,
  },
  user: {
    name: "",
    email: "",
    phone: "",
    image: "",
  },
};

function normalizeTab(value?: string): SettingsTab {
  if (value === "store") return "store";
  if (value === "payment") return "payment";
  if (value === "share") return "share";
  if (value === "notifications") return "notifications";
  if (value === "account") return "account";
  if (value === "shipping") return "shipping";
  if (value === "channels") return "channels";
  return "store";
}

function normalizeSlugInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .slice(0, 120);
}

export function VendorSettingsForm({
  initialTab,
  canEdit = false,
  canManageChannels = false,
}: VendorSettingsFormProps) {
  const t = useTranslations();
  const messages = useMessages();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    normalizeTab(initialTab),
  );
  const [settings, setSettings] = useState<VendorSettingsState>(DEFAULT_SETTINGS);
  const [vendorShippingEnabled, setVendorShippingEnabled] = useState(false);
  // The store's zones — the geography this vendor prices but does not define.
  const [platformShipping, setPlatformShipping] =
    useState<PlatformShippingSummary>(EMPTY_PLATFORM_SHIPPING);
  const [carrierOverrideAllowed, setCarrierOverrideAllowed] = useState(false);
  const [shiprocketAvailable, setShiprocketAvailable] = useState(false);
  // Tokens typed this session. Kept apart from `settings` because the server
  // never sends them back — merging them into the loaded state would make a
  // blank field indistinguishable from "clear the stored value".
  const [carrierDraft, setCarrierDraft] = useState<VendorCarrierDraft>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [demoMode, setDemoMode] = useState(DEFAULT_PROFILE_DEMO_MODE);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const isAccountDemoMode = demoMode.enabled && activeTab === "account";

  const hasMessage = (key: string): boolean => {
    const parts = key.split(".");
    let current: unknown = messages;

    for (const part of parts) {
      if (typeof current !== "object" || current === null) return false;
      const record = current as Record<string, unknown>;
      if (!(part in record)) return false;
      current = record[part];
    }

    return typeof current === "string";
  };

  const tSafe = (key: string, fallback: string) => {
    try {
      if (!hasMessage(key)) return fallback;
      const translate = t as unknown as (k: string) => string;
      const result = translate(key);
      return result && result !== key ? result : fallback;
    } catch {
      return fallback;
    }
  };

  // Built with the same formatter the storefront uses, so the preview cannot
  // drift from what buyers actually get. Phone rides along only when the vendor
  // enabled it AND there is an address block for it to sit under — matching the
  // gate the storefront data layer applies.
  const addressPreview = useMemo(() => {
    const formatted = formatVendorAddress(
      settings.vendor.address,
      settings.vendor.storeVisibility.addressDisplay,
    );
    const lines = formatted?.lines ?? [];
    const phone = settings.vendor.address.phone.trim();

    return settings.vendor.storeVisibility.showPhone && lines.length > 0 && phone
      ? [...lines, phone]
      : lines;
  }, [settings.vendor.address, settings.vendor.storeVisibility]);

  useEffect(() => {
    async function fetchSettings() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/vendor/settings");
        const json = (await res.json()) as {
          success?: boolean;
          data?: VendorSettingsState & {
            vendorShippingEnabled?: boolean;
            platformShipping?: PlatformShippingSummary;
            carrierOverrideAllowed?: boolean;
            shiprocketAvailable?: boolean;
            demoMode?: DemoModeState;
          };
          message?: string;
          error?: string;
        };

        if (!res.ok || !json.success || !json.data) {
          throw new Error(
            json.message || json.error || "Failed to load vendor settings",
          );
        }

        const enabled = Boolean(json.data.vendorShippingEnabled);
        setVendorShippingEnabled(enabled);
        setPlatformShipping(
          json.data.platformShipping || EMPTY_PLATFORM_SHIPPING,
        );
        // Both flags come from the store's shipping settings (carriers switched
        // on; origin country Shiprocket can dispatch from). They were sent by
        // the API since the carriers feature shipped but never stored here, so
        // the vendor carrier-account card below could never render.
        setCarrierOverrideAllowed(Boolean(json.data.carrierOverrideAllowed));
        setShiprocketAvailable(Boolean(json.data.shiprocketAvailable));
        if (json.data.demoMode) {
          setDemoMode(normalizeDemoModeState(json.data.demoMode));
        }
        setSettings({ vendor: json.data.vendor, user: json.data.user });
        // If the admin disabled shipping but the URL pointed at that tab, fall
        // back to the store tab so there's always visible content.
        if (!enabled) {
          setActiveTab((prev) => (prev === "shipping" ? "store" : prev));
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load vendor settings",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void fetchSettings();
  }, []);

  const saveSection = async (
    section: SettingsTab,
    data: Record<string, unknown>,
  ) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/vendor/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, data }),
      });

      const json = (await res.json()) as {
        success?: boolean;
        data?: VendorSettingsState & {
          vendorShippingEnabled?: boolean;
          platformShipping?: PlatformShippingSummary;
          carrierOverrideAllowed?: boolean;
        };
        message?: string;
        error?: string;
      };

      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.message || json.error || "Failed to save settings");
      }

      setVendorShippingEnabled(Boolean(json.data.vendorShippingEnabled));
      if (json.data.platformShipping) {
        setPlatformShipping(json.data.platformShipping);
      }
      if (typeof json.data.carrierOverrideAllowed === "boolean") {
        setCarrierOverrideAllowed(json.data.carrierOverrideAllowed);
      }
      setSettings({ vendor: json.data.vendor, user: json.data.user });

      if (section === "account") {
        await authClient
          .updateUser({
            name: json.data.user.name,
            image: json.data.user.image || undefined,
          })
          .catch(() => null);
      }

      toast.success(tSafe("common.saved", "Saved"));
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save settings",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const onStoreSave = async () => {
    await saveSection("store", {
      storeName: settings.vendor.storeName,
      slug: settings.vendor.slug,
      description: settings.vendor.description,
      logo: settings.vendor.logo,
      banner: settings.vendor.banner,
      address: settings.vendor.address,
      storeVisibility: settings.vendor.storeVisibility,
    });
  };

  const onPaymentSave = async () => {
    await saveSection("payment", {
      bankDetails: settings.vendor.bankDetails,
      payoutSettings: settings.vendor.payoutSettings,
    });
  };

  const onShareSave = async () => {
    // The vendor's own profiles moved here from the Store tab, so this section
    // saves both — one Save button for everything visible on the tab.
    await saveSection("share", {
      shareSettings: settings.vendor.shareSettings,
      socialProfiles: settings.vendor.socialProfiles,
    });
  };

  const onNotificationsSave = async () => {
    await saveSection("notifications", {
      notificationPreferences: settings.vendor.notificationPreferences,
    });
  };

  const onChannelsSave = async () => {
    await saveSection("channels", {
      messaging: settings.vendor.messaging,
    });
  };

  const onAccountSave = async () => {
    if (demoMode.enabled) {
      toast.error(demoMode.message);
      return;
    }

    await saveSection("account", {
      name: settings.user.name,
      phone: settings.user.phone,
      image: settings.user.image,
    });
  };

  const onShippingSave = async () => {
    const shipping = settings.vendor.shipping || EMPTY_VENDOR_SHIPPING;
    await saveSection("shipping", {
      shipping: {
        ...shipping,
        // Only the fields typed this session. The server merges them onto the
        // stored (encrypted) values, so a blank field keeps what is saved.
        ...(carrierOverrideAllowed
          ? { carriers: carrierDraft }
          : {}),
      },
    });
  };

  const onPasswordSave = async () => {
    if (demoMode.enabled) {
      toast.error(demoMode.message);
      return;
    }

    if (!passwordForm.newPassword || passwordForm.newPassword.length < 8) {
      toast.error(
        tSafe(
          "vendor.settingsForm.passwordMinLength",
          "New password must be at least 8 characters",
        ),
      );
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error(
        tSafe("vendor.settingsForm.passwordsDoNotMatch", "Passwords do not match"),
      );
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword || undefined,
          newPassword: passwordForm.newPassword,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };

      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || "Failed to update password");
      }

      toast.success(json.message || "Password updated successfully");
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update password",
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleActiveTabSave = async () => {
    if (activeTab === "store") {
      await onStoreSave();
      return;
    }
    if (activeTab === "payment") {
      await onPaymentSave();
      return;
    }
    if (activeTab === "share") {
      await onShareSave();
      return;
    }
    if (activeTab === "notifications") {
      await onNotificationsSave();
      return;
    }
    if (activeTab === "shipping") {
      await onShippingSave();
      return;
    }
    if (activeTab === "channels") {
      await onChannelsSave();
      return;
    }
    if (demoMode.enabled) {
      toast.error(demoMode.message);
      return;
    }
    await onAccountSave();
  };

  if (isLoading) {
    return (
      <Card className="mx-auto w-full max-w-6xl">
        <CardContent className="p-8 text-sm text-muted-foreground">
          {tSafe("common.loading", "Loading...")}
        </CardContent>
      </Card>
    );
  }

  const tabs = [
    {
      value: "store" as const,
      label: tSafe("vendor.storeProfile", "Store"),
      icon: Store,
    },
    {
      value: "payment" as const,
      label: tSafe("vendor.payment", "Payment"),
      icon: CreditCard,
    },
    {
      value: "share" as const,
      label: tSafe("vendor.settingsForm.shareButtons", "Share Buttons"),
      icon: Share2,
    },
    {
      value: "channels" as const,
      label: tSafe("vendor.settingsForm.messagingChannels", "Messaging"),
      icon: MessagesSquare,
    },
    {
      value: "notifications" as const,
      label: tSafe("common.notifications", "Notifications"),
      icon: Bell,
    },
    ...(vendorShippingEnabled
      ? [
          {
            value: "shipping" as const,
            label: tSafe("admin.sidebar.shipping", "Shipping"),
            icon: Truck,
          },
        ]
      : []),
    {
      value: "account" as const,
      label: tSafe("common.account", "Account"),
      icon: User,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {tSafe("vendor.settings", "Store Settings")}
          </h1>
          <p className="text-muted-foreground">
            {tSafe(
              "vendor.settingsDesc",
              "Manage your store profile and preferences",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleActiveTabSave}
            disabled={
              isSaving ||
              (activeTab === "channels" ? !canManageChannels : !canEdit) ||
              isAccountDemoMode
            }
            className="gap-2"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {tSafe("common.saveChanges", "Save changes")}
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(normalizeTab(v))}
        className="gap-6"
      >
        <div className="scrollbar-hide -mx-1 flex overflow-x-auto border-b">
          <TabsList className="h-auto w-fit min-w-full justify-start gap-1 rounded-none bg-transparent p-0 px-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.value;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={cn(
                    "-mb-px h-auto flex-none gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-medium shadow-none transition-colors",
                    "text-muted-foreground hover:text-foreground",
                    "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="store" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>
              {tSafe("vendor.storeProfile", "Store Profile")}
            </CardTitle>
            <CardDescription>
              {tSafe(
                "vendor.storeProfileDesc",
                "Manage your store details and branding",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>{tSafe("vendor.storeName", "Store Name")}</Label>
                <Input
                  value={settings.vendor.storeName}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: { ...prev.vendor, storeName: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{tSafe("vendor.settingsForm.storeSlug", "Store slug")}</Label>
                <Input
                  value={settings.vendor.slug}
                  placeholder={normalizeSlugInput(settings.vendor.storeName) || "store-slug"}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        slug: normalizeSlugInput(e.target.value),
                      },
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {tSafe(
                    "vendor.settingsForm.storeSlugHelp",
                    "Used in your public shop URL.",
                  )}
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{tSafe("vendor.storeDescription", "Description")}</Label>
                <Textarea
                  value={settings.vendor.description}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: { ...prev.vendor, description: e.target.value },
                    }))
                  }
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("vendor.settingsForm.logoUrl", "Store logo")}</Label>
                <MediaUploader
                  value={
                    settings.vendor.logo
                      ? [
                          {
                            _id: "vendor-logo",
                            url: settings.vendor.logo,
                            type: "image",
                            mimeType: "image/*",
                            alt: `${settings.vendor.storeName || "Store"} logo`,
                            position: 0,
                          },
                        ]
                      : []
                  }
                  onChange={(items) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        logo:
                          items.find((item) => item.type === "image")?.url || "",
                      },
                    }))
                  }
                  maxFiles={1}
                  acceptTypes={["image"]}
                  accept={VENDOR_IMAGE_ACCEPT}
                  allowedFileExtensions={VENDOR_IMAGE_EXTENSIONS}
                  uploadTitle="Drag and drop image, or click to browse"
                  uploadDescription="Image format: JPG, PNG, JPEG, WEBP."
                  sizeGuide="Recommended size: 512 x 512 px"
                  mediaGridClassName="grid-cols-1 md:grid-cols-1 max-w-32"
                  previewAspectRatio="1 / 1"
                  previewFit="contain"
                  previewTileClassName="bg-slate-50"
                  showCoverBadge={false}
                  coverHint={false}
                />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("vendor.settingsForm.bannerUrl", "Store banner")}</Label>
                <MediaUploader
                  value={
                    settings.vendor.banner
                      ? [
                          {
                            _id: "vendor-banner",
                            url: settings.vendor.banner,
                            type: "image",
                            mimeType: "image/*",
                            alt: `${settings.vendor.storeName || "Store"} banner`,
                            position: 0,
                          },
                        ]
                      : []
                  }
                  onChange={(items) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        banner:
                          items.find((item) => item.type === "image")?.url || "",
                      },
                    }))
                  }
                  maxFiles={1}
                  acceptTypes={["image"]}
                  accept={VENDOR_IMAGE_ACCEPT}
                  allowedFileExtensions={VENDOR_IMAGE_EXTENSIONS}
                  uploadTitle="Drag and drop image, or click to browse"
                  uploadDescription="Image format: JPG, PNG, JPEG, WEBP."
                  sizeGuide="Recommended size: 1360 x 314 px"
                  mediaGridClassName="grid-cols-1 md:grid-cols-1"
                  previewAspectRatio="1360 / 314"
                  previewFit="contain"
                  previewTileClassName="bg-slate-50"
                  showCoverBadge={false}
                  coverHint={false}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>{tSafe("vendor.registration.streetLabel", "Street")}</Label>
                <Input
                  value={settings.vendor.address.street}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        address: { ...prev.vendor.address, street: e.target.value },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("vendor.registration.cityLabel", "City")}</Label>
                <Input
                  value={settings.vendor.address.city}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        address: { ...prev.vendor.address, city: e.target.value },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("vendor.registration.stateLabel", "State")}</Label>
                <Input
                  value={settings.vendor.address.state}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        address: { ...prev.vendor.address, state: e.target.value },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {tSafe("vendor.registration.postalCodeLabel", "Postal Code")}
                </Label>
                <Input
                  value={settings.vendor.address.postalCode}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        address: {
                          ...prev.vendor.address,
                          postalCode: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("vendor.registration.countryLabel", "Country")}</Label>
                <CountrySelect
                  value={settings.vendor.address.country}
                  onChange={(country) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        address: { ...prev.vendor.address, country },
                      },
                    }))
                  }
                  placeholder={tSafe(
                    "vendor.registration.countryPlaceholder",
                    "Select country",
                  )}
                />
              </div>
            </div>

            {/* What buyers see of the address above. Kept next to the fields so
                the consequence of typing an address is visible at the moment of
                typing it, rather than discovered later on the live store. */}
            <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
              <div className="space-y-1">
                <Label className="text-sm font-semibold">
                  {tSafe(
                    "vendor.settingsForm.addressVisibility",
                    "Address on your store page",
                  )}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {tSafe(
                    "vendor.settingsForm.addressVisibilityHint",
                    "Your address is collected for payouts and verification. Choose how much of it buyers can see.",
                  )}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>
                    {tSafe("vendor.settingsForm.addressPrecision", "Show")}
                  </Label>
                  <Select
                    value={settings.vendor.storeVisibility.addressDisplay}
                    onValueChange={(value) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          storeVisibility: {
                            ...prev.vendor.storeVisibility,
                            addressDisplay: value as VendorAddressDisplay,
                          },
                        },
                      }))
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={VENDOR_ADDRESS_DISPLAY.HIDDEN}>
                        {tSafe(
                          "vendor.settingsForm.addressHidden",
                          "Nothing — keep my location private",
                        )}
                      </SelectItem>
                      <SelectItem value={VENDOR_ADDRESS_DISPLAY.CITY_COUNTRY}>
                        {tSafe(
                          "vendor.settingsForm.addressCityCountry",
                          "City and country only",
                        )}
                      </SelectItem>
                      <SelectItem value={VENDOR_ADDRESS_DISPLAY.FULL}>
                        {tSafe(
                          "vendor.settingsForm.addressFull",
                          "Full address with directions",
                        )}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-3 md:items-center">
                  <div className="space-y-0.5">
                    <Label className="text-sm">
                      {tSafe("vendor.settingsForm.showPhone", "Show phone number")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {tSafe(
                        "vendor.settingsForm.showPhoneHint",
                        "Published numbers attract spam.",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={settings.vendor.storeVisibility.showPhone}
                    onCheckedChange={(checked) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          storeVisibility: {
                            ...prev.vendor.storeVisibility,
                            showPhone: checked,
                          },
                        },
                      }))
                    }
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <div className="rounded-lg border bg-card p-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tSafe(
                    "vendor.settingsForm.addressPreview",
                    "Buyers will see",
                  )}
                </p>
                {addressPreview.length > 0 ? (
                  <address className="text-sm not-italic leading-relaxed">
                    {addressPreview.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </address>
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    {tSafe(
                      "vendor.settingsForm.addressPreviewEmpty",
                      "No location on your store page.",
                    )}
                  </p>
                )}
              </div>
            </div>

          </CardContent>
        </Card>
      </TabsContent>

        <TabsContent value="share" className="space-y-6">
          {/* Two related but distinct things live here, and the headings keep
              them apart: the vendor's OWN profiles, published in the Store
              information panel on their storefront — versus which buttons a
              shopper gets when they share the store. */}
          <Card>
            <CardHeader>
              <CardTitle>
                {tSafe("vendor.settingsForm.storeLinks", "Your links")}
              </CardTitle>
              <CardDescription>
                {tSafe(
                  "vendor.settingsForm.storeLinksDesc",
                  "Shown under “Online” in the Store information panel on your store page. Remove a link to hide it.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>
                  {tSafe("vendor.settingsForm.socialProfiles", "Social profiles")}
                </Label>
                <VendorSocialProfilesEditor
                  value={settings.vendor.socialProfiles}
                  onChange={(socialProfiles) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: { ...prev.vendor, socialProfiles },
                    }))
                  }
                  disabled={!canEdit}
                  labels={{
                    platform: tSafe(
                      "vendor.settingsForm.socialPlatform",
                      "Platform",
                    ),
                    url: tSafe("vendor.settingsForm.socialUrl", "Link"),
                    customLabel: tSafe(
                      "vendor.settingsForm.socialCustomLabel",
                      "Name shown to buyers",
                    ),
                    customLabelPlaceholder: tSafe(
                      "vendor.settingsForm.socialCustomLabelHint",
                      "e.g. Threads, Snapchat, our blog",
                    ),
                    add: tSafe("vendor.settingsForm.socialAdd", "Add link"),
                    remove: tSafe("vendor.settingsForm.socialRemove", "Remove link"),
                    empty: tSafe(
                      "vendor.settingsForm.socialEmpty",
                      "No social profiles yet. Add the ones you want buyers to find.",
                    ),
                    limitReached: tSafe(
                      "vendor.settingsForm.socialLimit",
                      "Maximum reached.",
                    ),
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <VendorShareSettings
            value={settings.vendor.shareSettings}
            onChange={(shareSettings) =>
              setSettings((prev) => ({
                ...prev,
                vendor: {
                  ...prev.vendor,
                  shareSettings,
                },
              }))
            }
          />
        </TabsContent>

        <TabsContent value="channels" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {tSafe(
                  "vendor.settingsForm.messagingChannels",
                  "Messaging channels",
                )}
              </CardTitle>
              <CardDescription>
                {tSafe(
                  "vendor.settingsForm.messagingChannelsDesc",
                  "Choose how buyers can contact your store. These settings are independent from whether your address phone number is public.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
                <div className="space-y-1">
                  <Label>Live chat</Label>
                  <p className="text-xs text-muted-foreground">
                    Buyers can message your vendor inbox without leaving the store.
                  </p>
                </div>
                <Switch
                  checked={settings.vendor.messaging.liveChatEnabled}
                  onCheckedChange={(liveChatEnabled) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        messaging: {
                          ...prev.vendor.messaging,
                          liveChatEnabled,
                        },
                      },
                    }))
                  }
                  disabled={!canManageChannels}
                />
              </div>

              <div className="space-y-4 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label>WhatsApp</Label>
                    <p className="text-xs text-muted-foreground">
                      Opens a direct chat with your own WhatsApp number.
                    </p>
                  </div>
                  <Switch
                    checked={settings.vendor.messaging.whatsapp.enabled}
                    onCheckedChange={(enabled) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            whatsapp: {
                              ...prev.vendor.messaging.whatsapp,
                              enabled,
                            },
                          },
                        },
                      }))
                    }
                    disabled={!canManageChannels}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor-whatsapp-number">
                    International phone number
                  </Label>
                  <Input
                    id="vendor-whatsapp-number"
                    value={settings.vendor.messaging.whatsapp.phoneNumberE164}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            whatsapp: {
                              ...prev.vendor.messaging.whatsapp,
                              phoneNumberE164: event.target.value,
                            },
                          },
                        },
                      }))
                    }
                    placeholder="+8801700000000"
                    disabled={!canManageChannels}
                  />
                  <p className="text-xs text-muted-foreground">
                    Include the country code. This number is used only for the
                    WhatsApp contact button.
                  </p>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label>Messenger</Label>
                    <p className="text-xs text-muted-foreground">
                      Opens a direct conversation with your Facebook Page.
                    </p>
                  </div>
                  <Switch
                    checked={settings.vendor.messaging.messenger.enabled}
                    onCheckedChange={(enabled) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            messenger: {
                              ...prev.vendor.messaging.messenger,
                              enabled,
                            },
                          },
                        },
                      }))
                    }
                    disabled={!canManageChannels}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor-messenger-page">
                    Facebook Page username
                  </Label>
                  <Input
                    id="vendor-messenger-page"
                    value={settings.vendor.messaging.messenger.pageUsername}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            messenger: {
                              ...prev.vendor.messaging.messenger,
                              pageUsername: event.target.value,
                            },
                          },
                        },
                      }))
                    }
                    placeholder="your.page or https://m.me/your.page"
                    disabled={!canManageChannels}
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label>Instagram</Label>
                    <p className="text-xs text-muted-foreground">
                      Opens a direct message with your Instagram professional
                      account.
                    </p>
                  </div>
                  <Switch
                    checked={settings.vendor.messaging.instagram.enabled}
                    onCheckedChange={(enabled) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            instagram: {
                              ...prev.vendor.messaging.instagram,
                              enabled,
                            },
                          },
                        },
                      }))
                    }
                    disabled={!canManageChannels}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor-instagram-username">
                    Instagram username
                  </Label>
                  <Input
                    id="vendor-instagram-username"
                    value={settings.vendor.messaging.instagram.username}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            instagram: {
                              ...prev.vendor.messaging.instagram,
                              username: event.target.value,
                            },
                          },
                        },
                      }))
                    }
                    placeholder="your.handle or https://ig.me/m/your.handle"
                    disabled={!canManageChannels}
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label>Telegram</Label>
                    <p className="text-xs text-muted-foreground">
                      Opens a chat with your Telegram bot.
                    </p>
                  </div>
                  <Switch
                    checked={settings.vendor.messaging.telegram.enabled}
                    onCheckedChange={(enabled) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            telegram: {
                              ...prev.vendor.messaging.telegram,
                              enabled,
                            },
                          },
                        },
                      }))
                    }
                    disabled={!canManageChannels}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor-telegram-username">
                    Telegram bot username
                  </Label>
                  <Input
                    id="vendor-telegram-username"
                    value={settings.vendor.messaging.telegram.username}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        vendor: {
                          ...prev.vendor,
                          messaging: {
                            ...prev.vendor.messaging,
                            telegram: {
                              ...prev.vendor.messaging.telegram,
                              username: event.target.value,
                            },
                          },
                        },
                      }))
                    }
                    placeholder="your_store_bot or https://t.me/your_store_bot"
                    disabled={!canManageChannels}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          <ChannelConnectionsPanel canManage={canManageChannels} />
        </TabsContent>

        <TabsContent value="payment" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>
              {tSafe("vendor.paymentSettings", "Payment Settings")}
            </CardTitle>
            <CardDescription>
              {tSafe(
                "vendor.paymentSettingsDesc",
                "Manage your payout details",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  {tSafe("vendor.settingsForm.accountName", "Account Name")}
                </Label>
                <Input
                  value={settings.vendor.bankDetails.accountName}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        bankDetails: {
                          ...prev.vendor.bankDetails,
                          accountName: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {tSafe("vendor.settingsForm.accountNumber", "Account Number")}
                </Label>
                <Input
                  value={settings.vendor.bankDetails.accountNumber}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        bankDetails: {
                          ...prev.vendor.bankDetails,
                          accountNumber: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("vendor.settingsForm.bankName", "Bank Name")}</Label>
                <Input
                  value={settings.vendor.bankDetails.bankName}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        bankDetails: {
                          ...prev.vendor.bankDetails,
                          bankName: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {tSafe("vendor.settingsForm.routingNumber", "Routing Number")}
                </Label>
                <Input
                  value={settings.vendor.bankDetails.routingNumber}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        bankDetails: {
                          ...prev.vendor.bankDetails,
                          routingNumber: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{tSafe("vendor.settingsForm.swiftCode", "SWIFT Code")}</Label>
                <Input
                  value={settings.vendor.bankDetails.swiftCode}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        bankDetails: {
                          ...prev.vendor.bankDetails,
                          swiftCode: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  {tSafe("vendor.settingsForm.payoutSchedule", "Payout Schedule")}
                </Label>
                <Select
                  value={settings.vendor.payoutSettings.schedule}
                  onValueChange={(value: "weekly" | "biweekly" | "monthly") =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        payoutSettings: {
                          ...prev.vendor.payoutSettings,
                          schedule: value,
                        },
                      },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">
                      {tSafe("vendor.settingsForm.payoutWeekly", "Weekly")}
                    </SelectItem>
                    <SelectItem value="biweekly">
                      {tSafe("vendor.settingsForm.payoutBiweekly", "Biweekly")}
                    </SelectItem>
                    <SelectItem value="monthly">
                      {tSafe("vendor.settingsForm.payoutMonthly", "Monthly")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {tSafe(
                    "vendor.settingsForm.minimumPayoutAmount",
                    "Minimum Payout Amount",
                  )}
                </Label>
                <NumberInput
                  min={0}
                  step="0.01"
                  value={settings.vendor.payoutSettings.minimumAmount ?? 0}
                  whenEmpty={0}
                  onValueChange={(next) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: {
                        ...prev.vendor,
                        payoutSettings: {
                          ...prev.vendor.payoutSettings,
                          minimumAmount: next ?? 0,
                        },
                      },
                    }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>
              {tSafe("vendor.notificationSettings", "Notification Settings")}
            </CardTitle>
            <CardDescription>
              {tSafe(
                "vendor.notificationSettingsDesc",
                "Control how you receive updates",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">
                  {tSafe("vendor.settingsForm.newOrders", "New Orders")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "vendor.settingsForm.newOrdersDesc",
                    "Receive alerts when customers place a new order.",
                  )}
                </p>
              </div>
              <Switch
                checked={settings.vendor.notificationPreferences.newOrders}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    vendor: {
                      ...prev.vendor,
                      notificationPreferences: {
                        ...prev.vendor.notificationPreferences,
                        newOrders: checked,
                      },
                    },
                  }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">
                  {tSafe(
                    "vendor.settingsForm.orderStatusUpdates",
                    "Order Status Updates",
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "vendor.settingsForm.orderStatusUpdatesDesc",
                    "Get reminders and status updates for your active orders.",
                  )}
                </p>
              </div>
              <Switch
                checked={settings.vendor.notificationPreferences.orderUpdates}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    vendor: {
                      ...prev.vendor,
                      notificationPreferences: {
                        ...prev.vendor.notificationPreferences,
                        orderUpdates: checked,
                      },
                    },
                  }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">
                  {tSafe("vendor.settingsForm.lowStockAlerts", "Low Stock Alerts")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "vendor.settingsForm.lowStockAlertsDesc",
                    "Notify me when products are running low.",
                  )}
                </p>
              </div>
              <Switch
                checked={settings.vendor.notificationPreferences.lowStock}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    vendor: {
                      ...prev.vendor,
                      notificationPreferences: {
                        ...prev.vendor.notificationPreferences,
                        lowStock: checked,
                      },
                    },
                  }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">
                  {tSafe(
                    "vendor.settingsForm.productTipsAndUpdates",
                    "Product Tips and Updates",
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "vendor.settingsForm.productTipsAndUpdatesDesc",
                    "Receive product announcements and vendor improvement tips.",
                  )}
                </p>
              </div>
              <Switch
                checked={settings.vendor.notificationPreferences.marketing}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    vendor: {
                      ...prev.vendor,
                      notificationPreferences: {
                        ...prev.vendor.notificationPreferences,
                        marketing: checked,
                      },
                    },
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

        {vendorShippingEnabled ? (
          <TabsContent value="shipping" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {tSafe("admin.settings.shipping.title", "Shipping & Delivery")}
                </CardTitle>
                <CardDescription>
                  {tSafe(
                    "vendor.shippingSettingsDesc",
                    "Configure how your own products are shipped. These rates apply to your items in customer carts.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <VendorShippingEditor
                  platformShipping={platformShipping}
                  value={settings.vendor.shipping || EMPTY_VENDOR_SHIPPING}
                  onChange={(next) =>
                    setSettings((prev) => ({
                      ...prev,
                      vendor: { ...prev.vendor, shipping: next },
                    }))
                  }
                />

                {/* Only when the store has carriers switched on — without a
                    platform account there is nothing to override. */}
                {carrierOverrideAllowed ? (
                  <VendorCarrierAccountCard
                    // The API replaces the stored tokens with presence flags
                    // and masked hints before this ever reaches the browser.
                    view={
                      (settings.vendor.shipping
                        ?.carriers as unknown as VendorCarrierView) ??
                      EMPTY_VENDOR_CARRIER_VIEW
                    }
                    draft={carrierDraft}
                    onChange={setCarrierDraft}
                    shiprocketAvailable={shiprocketAvailable}
                  />
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        <TabsContent value="account" className="space-y-6">
        {demoMode.enabled && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5">Demo mode</p>
              <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
                {demoMode.message}
              </p>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{tSafe("vendor.accountSettings", "Account")}</CardTitle>
            <CardDescription>
              {tSafe(
                "vendor.accountSettingsDesc",
                "Manage your personal account details",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
              <div className="w-24 shrink-0">
                <MediaUploader
                  value={
                    settings.user.image
                      ? [
                          {
                            _id: "vendor-profile-image",
                            url: settings.user.image,
                            type: "image",
                            mimeType: "image/*",
                            alt: `${settings.user.name || "Vendor"} profile image`,
                            position: 0,
                          },
                        ]
                      : []
                  }
                  onChange={(items) =>
                    setSettings((prev) => ({
                      ...prev,
                      user: {
                        ...prev.user,
                        image:
                          items.find((item) => item.type === "image")?.url || "",
                      },
                    }))
                  }
                  maxFiles={1}
                  acceptTypes={["image"]}
                  accept={VENDOR_IMAGE_ACCEPT}
                  allowedFileExtensions={VENDOR_IMAGE_EXTENSIONS}
                  disabled={demoMode.enabled}
                  uploadTitle="Upload"
                  uploadDescription=""
                  mediaGridClassName="grid-cols-1 md:grid-cols-1"
                  uploadZoneClassName="aspect-square rounded-full p-2"
                  previewAspectRatio="1 / 1"
                  previewFit="cover"
                  previewTileClassName="rounded-full overflow-hidden bg-slate-100"
                  showCoverBadge={false}
                  coverHint={false}
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">
                  {tSafe("profile.profileImage", "Profile image")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "profile.profileImageHint",
                    "This photo appears on your account and storefront. JPG, PNG or WEBP — recommended 512 × 512 px.",
                  )}
                </p>
              </div>
            </div>
            <fieldset disabled={demoMode.enabled} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{tSafe("profile.fullName", "Full Name")}</Label>
                <Input
                  value={settings.user.name}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      user: { ...prev.user, name: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("profile.email", "Email")}</Label>
                <Input value={settings.user.email} disabled />
              </div>
              <div className="space-y-2">
                <Label>{tSafe("profile.phone", "Phone")}</Label>
                <Input
                  value={settings.user.phone}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      user: { ...prev.user, phone: e.target.value },
                    }))
                  }
                />
              </div>
            </div>
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              {tSafe("profile.changePassword", "Change Password")}
            </CardTitle>
            <CardDescription>
              {tSafe(
                "vendor.settingsForm.changePasswordDesc",
                "Update your password to keep your vendor account secure.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset disabled={demoMode.enabled} className="space-y-4">
            <div className="space-y-2">
              <Label>{tSafe("profile.oldPassword", "Current Password")}</Label>
              <Input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    currentPassword: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{tSafe("profile.newPassword", "New Password")}</Label>
              <Input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    newPassword: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{tSafe("profile.confirmPassword", "Confirm Password")}</Label>
              <Input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    confirmPassword: e.target.value,
                  }))
                }
                />
            </div>

            <Button
              onClick={onPasswordSave}
              disabled={demoMode.enabled || isChangingPassword}
            >
              {isChangingPassword && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {tSafe("profile.updatePassword", "Update Password")}
            </Button>
            </fieldset>
          </CardContent>
        </Card>

        {/* Two-factor authentication (personal preference; only shown when the
            administrator has enabled the 2FA feature). */}
        <TwoFactorManagementCard
          disabled={demoMode.enabled}
          disabledMessage={demoMode.enabled ? demoMode.message : undefined}
        />
        </TabsContent>
      </Tabs>
    </div>
  );
}
