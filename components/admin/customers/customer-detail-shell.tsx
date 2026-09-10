"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Trash2,
  User,
  ShoppingBag,
  Activity,
  Award,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { DetailFormSkeleton } from "@/components/admin/detail-form-skeleton";
import { CustomerDetailHeader } from "./customer-detail-header";
import { ProfileTab } from "./tabs/profile-tab";
import { OrdersTab } from "./tabs/orders-tab";
import { ActivityTab } from "./tabs/activity-tab";
import { LoyaltyTab } from "./tabs/loyalty-tab";
import { NotesTab } from "./tabs/notes-tab";
import {
  defaultCustomerFormValues,
  defaultEmailNotifications,
  type CustomerEmailNotifications,
  type CustomerFormValues,
  type CustomerHeaderData,
  type CustomerStatus,
  type LoyaltyTier,
} from "./customer-detail-types";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";

interface CustomerDetailShellProps {
  locale: string;
  customerId: string;
  readOnly?: boolean;
  area?: "admin" | "staff";
}

interface CustomerDetailsResponse {
  _id: string;
  loyaltyPoints?: number;
  lifetimePoints?: number;
  loyaltyTier?: LoyaltyTier;
  tags?: string[];
  notes?: string;
  acquisitionSource?: string;
  marketingOptIn?: boolean;
  emailNotifications?: Partial<CustomerEmailNotifications>;
  stats?: CustomerHeaderData["stats"];
  lastActiveAt?: string;
  createdAt?: string;
  /** Guest rows carry identity on the profile itself — there is no user. */
  isGuest?: boolean;
  email?: string;
  name?: string;
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    street?: string;
    apartment?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  };
  userId:
    | string
    | {
        _id: string;
        name?: string;
        email?: string;
        phone?: string;
        image?: string;
        status?: CustomerStatus;
      };
}

function parseTags(input: string): string[] {
  if (!input.trim()) return [];
  return Array.from(
    new Set(
      input
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function getUser(profile: CustomerDetailsResponse) {
  if (profile.userId && typeof profile.userId === "object") {
    return profile.userId;
  }
  return null;
}

function buildShippingAddressPayload(form: CustomerFormValues) {
  const address = {
    firstName: form.shippingFirstName.trim(),
    lastName: form.shippingLastName.trim(),
    street: form.shippingStreet.trim(),
    apartment: form.shippingApartment.trim(),
    city: form.shippingCity.trim(),
    state: form.shippingState.trim(),
    postalCode: form.shippingPostalCode.trim(),
    country: form.shippingCountry.trim(),
    phone: form.shippingPhone.trim(),
  };

  const hasAnyAddressValue = Object.values(address).some(Boolean);
  if (!hasAnyAddressValue)
    return { value: undefined as undefined, error: null as string | null };

  if (!address.street || !address.city || !address.postalCode || !address.country) {
    return {
      value: undefined,
      error: "Shipping address requires street, city, postal code, and country",
    };
  }

  return {
    value: {
      ...address,
      firstName: address.firstName || undefined,
      lastName: address.lastName || undefined,
      apartment: address.apartment || undefined,
      state: address.state || undefined,
      phone: address.phone || undefined,
      isDefault: true as const,
      label: "home" as const,
    },
    error: null,
  };
}

/** Structural placeholder so the header renders its shape before data arrives. */
const LOADING_HEADER: CustomerHeaderData = {
  name: "",
  email: "",
  status: "active",
  loyaltyTier: "bronze",
  loyaltyPoints: 0,
  lifetimePoints: 0,
  stats: {},
};

export function CustomerDetailShell({
  locale,
  customerId,
  readOnly,
  area = "admin",
}: CustomerDetailShellProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const basePath = `/${locale}/${area}`;

  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [form, setForm] = useState<CustomerFormValues>(defaultCustomerFormValues);
  const [savedForm, setSavedForm] = useState<CustomerFormValues>(
    defaultCustomerFormValues,
  );
  const [header, setHeader] = useState<CustomerHeaderData | null>(null);
  const [lifetimePoints, setLifetimePoints] = useState(0);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    let active = true;

    const loadCustomer = async () => {
      try {
        const res = await fetch(`/api/admin/customers/${customerId}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || "Failed to load customer");
        }

        if (!active) return;
        const profile: CustomerDetailsResponse = data.data?.profile;
        const user = getUser(profile);

        const loaded: CustomerFormValues = {
          // Guest profiles have no user behind them; the identity the guest
          // typed at checkout lives on the profile itself.
          name: user?.name || profile.name || "",
          email: user?.email || profile.email || "",
          phone: user?.phone || "",
          image: user?.image || "",
          status: user?.status || USER_ACCOUNT_STATUS.ACTIVE,
          loyaltyPoints: profile.loyaltyPoints || 0,
          loyaltyTier: profile.loyaltyTier || "bronze",
          acquisitionSource: profile.acquisitionSource || "",
          tagsInput: (profile.tags || []).join(", "),
          notes: profile.notes || "",
          marketingOptIn: profile.marketingOptIn ?? false,
          emailNotifications: {
            ...defaultEmailNotifications,
            ...(profile.emailNotifications || {}),
          },
          shippingFirstName: profile.shippingAddress?.firstName || "",
          shippingLastName: profile.shippingAddress?.lastName || "",
          shippingStreet: profile.shippingAddress?.street || "",
          shippingApartment: profile.shippingAddress?.apartment || "",
          shippingCity: profile.shippingAddress?.city || "",
          shippingState: profile.shippingAddress?.state || "",
          shippingPostalCode: profile.shippingAddress?.postalCode || "",
          shippingCountry: profile.shippingAddress?.country || "",
          shippingPhone: profile.shippingAddress?.phone || "",
        };

        setForm(loaded);
        setSavedForm(loaded);
        setLifetimePoints(profile.lifetimePoints || 0);
        setHeader({
          name: loaded.name,
          email: loaded.email,
          image: user?.image,
          status: loaded.status,
          loyaltyTier: loaded.loyaltyTier,
          loyaltyPoints: loaded.loyaltyPoints,
          lifetimePoints: profile.lifetimePoints || 0,
          stats: profile.stats || {},
          lastActiveAt: profile.lastActiveAt,
          createdAt: profile.createdAt,
        });
      } catch (error) {
        if (!active) return;
        console.error("Failed to fetch customer:", error);
        toast.error("Failed to load customer");
      } finally {
        if (active) setIsFetching(false);
      }
    };

    void loadCustomer();
    return () => {
      active = false;
    };
  }, [customerId]);

  // Warn on hard navigation / tab close while there are unsaved changes.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const setField = useCallback(
    <K extends keyof CustomerFormValues>(
      key: K,
      value: CustomerFormValues[K],
    ) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const confirmDiscard = useCallback(async () => {
    if (!isDirtyRef.current) return true;
    return confirm({
      title: "Discard unsaved changes?",
      description:
        "You have unsaved changes on this customer. Leaving now will lose them.",
      confirmText: "Discard",
      cancelText: "Keep editing",
      variant: "destructive",
    });
  }, [confirm]);

  const navigateBack = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    router.push(`${basePath}/customers`);
  }, [basePath, confirmDiscard, router]);

  const handleSubmit = useCallback(async () => {
    if (readOnly) return;
    if (!form.name.trim()) {
      toast.error("Name is required");
      setActiveTab("profile");
      return;
    }
    if (!form.email.trim()) {
      toast.error("Email is required");
      setActiveTab("profile");
      return;
    }

    const shippingAddressPayload = buildShippingAddressPayload(form);
    if (shippingAddressPayload.error) {
      toast.error(shippingAddressPayload.error);
      setActiveTab("profile");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        image: form.image.trim(),
        phone: form.phone.trim() || undefined,
        status: form.status,
        loyaltyPoints: Number.isFinite(form.loyaltyPoints)
          ? Math.max(0, Math.floor(form.loyaltyPoints))
          : 0,
        loyaltyTier: form.loyaltyTier,
        acquisitionSource: form.acquisitionSource.trim() || undefined,
        tags: parseTags(form.tagsInput),
        notes: form.notes.trim() || undefined,
        marketingOptIn: form.marketingOptIn,
        emailNotifications: form.emailNotifications,
        shippingAddress: shippingAddressPayload.value,
      };

      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to save customer");
      }

      toast.success("Customer updated successfully");
      setSavedForm(form);
      setHeader((prev) =>
        prev
          ? {
              ...prev,
              name: form.name,
              email: form.email,
              image: form.image || undefined,
              status: form.status,
              loyaltyTier: form.loyaltyTier,
              loyaltyPoints: form.loyaltyPoints,
            }
          : prev,
      );
      router.refresh();
    } catch (error) {
      console.error("Save customer failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save customer",
      );
    } finally {
      setIsSaving(false);
    }
  }, [customerId, form, readOnly, router]);

  const handleDelete = useCallback(async () => {
    if (!customerId || readOnly) return;

    const shouldDelete = await confirm({
      title: "Delete customer",
      description:
        "This permanently removes the customer profile and user account.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    });
    if (!shouldDelete) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to delete customer");
      }

      toast.success("Customer deleted successfully");
      setSavedForm(form); // suppress the unsaved-changes guard on navigation
      router.push(`${basePath}/customers`);
      router.refresh();
    } catch (error) {
      console.error("Delete customer failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete customer",
      );
    } finally {
      setIsDeleting(false);
    }
  }, [basePath, confirm, customerId, form, readOnly, router]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title="Customer Details"
        description="View and update customer profile, loyalty, and internal notes"
        status={
          isDirty && !readOnly ? (
            <span className="text-xs font-medium text-amber-600">
              Unsaved changes
            </span>
          ) : null
        }
        actions={
          <>
            {!readOnly && (
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={isFetching || isSaving || isDeleting || !isDirty}
              >
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={navigateBack}
              disabled={isSaving || isDeleting}
            >
              Back to customers
            </Button>
          </>
        }
      />

      <CustomerDetailHeader data={header ?? LOADING_HEADER} loading={isFetching} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
          {[
            { value: "profile", label: "Profile", icon: User },
            { value: "orders", label: "Orders", icon: ShoppingBag },
            { value: "activity", label: "Activity", icon: Activity },
            { value: "loyalty", label: "Loyalty", icon: Award },
            { value: "notes", label: "Notes", icon: StickyNote },
          ].map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex-none gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2.5 font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:border-primary"
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="profile">
          {isFetching ? (
            <DetailFormSkeleton />
          ) : (
            <ProfileTab form={form} setField={setField} readOnly={readOnly} />
          )}
        </TabsContent>

        <TabsContent value="orders">
          <OrdersTab
            customerId={customerId}
            basePath={basePath}
            stats={header?.stats ?? {}}
          />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTab
            customerId={customerId}
            acquisitionSource={form.acquisitionSource}
            lastActiveAt={header?.lastActiveAt}
            createdAt={header?.createdAt}
            stats={header?.stats ?? {}}
          />
        </TabsContent>

        <TabsContent value="loyalty">
          {isFetching ? (
            <DetailFormSkeleton />
          ) : (
            <LoyaltyTab
              form={form}
              setField={setField}
              readOnly={readOnly}
              lifetimePoints={lifetimePoints}
            />
          )}
        </TabsContent>

        <TabsContent value="notes" className="space-y-6">
          {isFetching ? (
            <DetailFormSkeleton cards={1} />
          ) : (
            <NotesTab form={form} setField={setField} readOnly={readOnly} />
          )}

          {!isFetching && !readOnly && (
            <Card>
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>
                  Delete this customer permanently
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isSaving || isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete customer
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {readOnly && (
        <p className="text-sm text-muted-foreground">
          You have view-only access for this customer.
        </p>
      )}
    </div>
  );
}
