"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  RefreshCw,
  Trash2,
  Store,
  Package,
  ShoppingBag,
  Wallet,
  ShieldCheck,
  CreditCard,
  Landmark,
  FileText,
  StickyNote,
  History,
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
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { DetailFormSkeleton } from "@/components/admin/detail-form-skeleton";
import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import type { VendorPermission } from "@/config/permissions.config";
import { VendorDetailHeader } from "./vendor-detail-header";
import type {
  PackLayerSnapshot,
  VendorOverrideDraft,
} from "./vendor-access-view";
import { ProfileTab } from "./tabs/profile-tab";
import { AccessTab } from "./tabs/access-tab";
import { VendorPreorderAccessCard } from "./vendor-preorder-access-card";
import { SubscriptionTab } from "./tabs/subscription-tab";
import { ProductsTab } from "./tabs/products-tab";
import { OrdersTab } from "./tabs/orders-tab";
import { PayoutsTab } from "./tabs/payouts-tab";
import { BusinessTab } from "./tabs/business-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { NotesTab } from "./tabs/notes-tab";
import { ActivityTab } from "./tabs/activity-tab";
import {
  defaultVendorFormValues,
  type VendorFormValues,
  type VendorHeaderData,
  type VendorStats,
  type VendorSubscriptionSummary,
} from "./vendor-detail-types";

interface VendorDetailShellProps {
  locale: string;
  vendorId: string;
  readOnly?: boolean;
}

interface VendorResponse {
  storeName?: string;
  slug?: string;
  description?: string;
  logo?: string;
  banner?: string;
  commission?: number;
  shipping?: { codCollectedBy?: string };
  status?: string;
  verified?: boolean;
  /** @deprecated legacy grant list; the server resolves access itself now. */
  permissions?: VendorPermission[];
  permissionOverrides?: VendorOverrideDraft[];
  /** Policy + entitlement per pack, already resolved by the GET. */
  packLayers?: PackLayerSnapshot[];
  entitlementNote?: string;
  entitlementWarning?: boolean;
  accessMode?: "approved" | "setup" | "blocked";
  notes?: string;
  /** Review record; the reason is what the applicant sees on become-vendor. */
  application?: {
    status?: string | null;
    rejectionReason?: string | null;
    rejectedAt?: string | null;
  } | null;
  createdAt?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  };
  bankDetails?: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    routingNumber?: string;
    swiftCode?: string;
  };
  documents?: {
    businessLicense?: string;
    taxId?: string;
    taxCertificate?: string;
    governmentId?: string;
  };
  user?: {
    name?: string;
    email?: string;
    phone?: string;
    status?: VendorFormValues["userStatus"];
  };
  subscription?: {
    planId?: string;
    status?: string;
    /** Billing rail: "stripe" | "manual" | a one-shot gateway id. */
    provider?: string | null;
    paymentProviderRef?: string | null;
    commissionRateSnapshot?: number;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    trialEnd?: string;
    cancelAtPeriodEnd?: boolean;
    providerStatus?: string | null;
    stripePriceId?: string | null;
    stripeLatestInvoiceId?: string | null;
    gracePeriodEnd?: string | null;
    pendingChangeType?: string | null;
    pendingChangeStatus?: string | null;
    pendingChangeEffectiveAt?: string | null;
    pendingPlanSnapshot?: { name?: string } | null;
    lastReconcileError?: string | null;
    lastReconciledAt?: string | null;
    lastPayment?: {
      providerInvoiceId?: string;
      status?: string;
      amountDue?: number;
      amountPaid?: number;
      currency?: string;
      paidAt?: string | null;
    } | null;
    planSnapshot?: {
      name?: string;
      price?: number;
      billingInterval?: string;
    };
  } | null;
  subscriptionStatus?: string | null;
  onboardingResponses?: Record<
    string,
    { label?: string; value?: string | boolean }
  >;
}

function mapSubscription(
  vendor: VendorResponse,
): VendorSubscriptionSummary | null {
  const sub = vendor.subscription;
  if (!sub) return null;
  return {
    planId: sub.planId ? String(sub.planId) : undefined,
    status: sub.status ?? vendor.subscriptionStatus ?? null,
    // Drives every non-Stripe affordance in the Subscription tab (the offline
    // "record payment / extend" lever, and whether cancelling is immediate or
    // scheduled). Dropping it here silently disabled all of them.
    provider: sub.provider ?? null,
    paymentProviderRef: sub.paymentProviderRef ?? null,
    planName: sub.planSnapshot?.name,
    price: sub.planSnapshot?.price,
    billingInterval: sub.planSnapshot?.billingInterval,
    commissionRateSnapshot: sub.commissionRateSnapshot,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    trialEnd: sub.trialEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    providerStatus: sub.providerStatus,
    stripePriceId: sub.stripePriceId,
    stripeLatestInvoiceId: sub.stripeLatestInvoiceId,
    gracePeriodEnd: sub.gracePeriodEnd,
    pendingChangeType: sub.pendingChangeType,
    pendingChangeStatus: sub.pendingChangeStatus,
    pendingChangeEffectiveAt: sub.pendingChangeEffectiveAt,
    pendingPlanName: sub.pendingPlanSnapshot?.name,
    lastReconcileError: sub.lastReconcileError,
    lastReconciledAt: sub.lastReconciledAt,
    lastPayment: sub.lastPayment,
  };
}

/** Structural placeholder so the header renders its shape before data arrives. */
const LOADING_HEADER: VendorHeaderData = {
  storeName: "",
  slug: "",
  status: VENDOR_STATUS.PENDING,
  ownerEmail: "",
};

export function VendorDetailShell({
  locale,
  vendorId,
  readOnly,
}: VendorDetailShellProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const basePath = `/${locale}/admin`;

  const [isFetching, setIsFetching] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [form, setForm] = useState<VendorFormValues>(defaultVendorFormValues);
  const [savedForm, setSavedForm] = useState<VendorFormValues>(
    defaultVendorFormValues,
  );
  const [header, setHeader] = useState<VendorHeaderData | null>(null);
  // Commerce counts live beside the header rather than inside it. They arrive
  // from their own request, and merging them into a possibly-not-yet-created
  // header object meant the loser of that race was thrown away.
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [subscription, setSubscription] =
    useState<VendorSubscriptionSummary | null>(null);
  const [plansEnabled, setPlansEnabled] = useState(false);
  const [onboardingResponses, setOnboardingResponses] = useState<
    Array<{ key: string; label: string; value: string | boolean }>
  >([]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Settings is the authority on whether plans are enabled; the vendor payload
  // only carries the "has a subscription row" heuristic. Whichever request
  // lands first, the heuristic must never overwrite the answer.
  const plansEnabledResolvedRef = useRef(false);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const applyVendor = useCallback((
    vendor: VendorResponse,
    options?: { keepEdits?: boolean },
  ) => {
    const loaded: VendorFormValues = {
      storeName: vendor.storeName || "",
      slug: vendor.slug || "",
      description: vendor.description || "",
      logo: vendor.logo || "",
      banner: vendor.banner || "",
      commission:
        typeof vendor.commission === "number"
          ? vendor.commission
          : defaultVendorFormValues.commission,
      codCollectedBy: vendor.shipping?.codCollectedBy || "inherit",
      status: vendor.status || VENDOR_STATUS.PENDING,
      verified: vendor.verified === true,
      userStatus: vendor.user?.status || USER_ACCOUNT_STATUS.ACTIVE,
      ownerName: vendor.user?.name || "",
      ownerEmail: vendor.user?.email || "",
      ownerPhone: vendor.user?.phone || "",
      // Overrides are what an admin edits; the policy and entitlement layers
      // arrive already resolved so the tab never re-derives rules the server
      // owns. An absent override array on an unmigrated vendor reads as "no
      // deviations" here — the server still honours its legacy list until the
      // first save, which then writes the overrides explicitly.
      permissionOverrides: Array.isArray(vendor.permissionOverrides)
        ? vendor.permissionOverrides
        : [],
      packLayers: Array.isArray(vendor.packLayers) ? vendor.packLayers : [],
      entitlementNote: vendor.entitlementNote || "",
      entitlementWarning: vendor.entitlementWarning === true,
      accessMode: vendor.accessMode ?? "approved",
      expandedPack: "",
      notes: vendor.notes || "",
      rejectionReason: vendor.application?.rejectionReason || "",
      addressStreet: vendor.address?.street || "",
      addressCity: vendor.address?.city || "",
      addressState: vendor.address?.state || "",
      addressPostalCode: vendor.address?.postalCode || "",
      addressCountry: vendor.address?.country || "",
      addressPhone: vendor.address?.phone || "",
      bankAccountName: vendor.bankDetails?.accountName || "",
      bankAccountNumber: vendor.bankDetails?.accountNumber || "",
      bankName: vendor.bankDetails?.bankName || "",
      bankRoutingNumber: vendor.bankDetails?.routingNumber || "",
      bankSwiftCode: vendor.bankDetails?.swiftCode || "",
      docBusinessLicense: vendor.documents?.businessLicense || "",
      docTaxId: vendor.documents?.taxId || "",
      docTaxCertificate: vendor.documents?.taxCertificate || "",
      docGovernmentId: vendor.documents?.governmentId || "",
    };

    // `savedForm` is always the server's state — it is the baseline the dirty
    // check compares against. `form` is only replaced when there is nothing to
    // lose, so a background refresh (assigning a plan, for instance) can no
    // longer wipe edits the admin has not saved yet.
    setSavedForm(loaded);
    if (!options?.keepEdits || !isDirtyRef.current) {
      setForm(loaded);
    }
    setSubscription(mapSubscription(vendor));
    setHeader({
      storeName: loaded.storeName,
      slug: loaded.slug,
      logo: loaded.logo || undefined,
      status: loaded.status,
      ownerEmail: loaded.ownerEmail,
      createdAt: vendor.createdAt,
    });
    if (!plansEnabledResolvedRef.current) {
      setPlansEnabled(Boolean(vendor.subscription));
    }

    const respObj =
      vendor.onboardingResponses &&
      typeof vendor.onboardingResponses === "object"
        ? vendor.onboardingResponses
        : {};
    setOnboardingResponses(
      Object.entries(respObj).map(([key, v]) => ({
        key,
        label: v?.label || key,
        value: v?.value ?? "",
      })),
    );
  }, []);

  const loadVendor = useCallback(
    async (options?: { keepEdits?: boolean }) => {
      try {
        const vendor = await apiClient.get<VendorResponse>(
          `/api/admin/vendors/${vendorId}`,
        );
        if (!mountedRef.current) return;
        applyVendor(vendor, options);
      } catch (error) {
        if (!mountedRef.current) return;
        console.error("Failed to fetch vendor:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to load vendor",
        );
      }
    },
    [applyVendor, vendorId],
  );

  // Does not flip `statsLoading` on itself: the mount effect starts with it
  // already true, and setting state synchronously from an effect body costs a
  // cascading render. Refreshes turn the skeleton back on via `refreshAll`.
  const loadStats = useCallback(async () => {
    try {
      const res = await apiClient.get<VendorStats>(
        `/api/admin/vendors/${vendorId}/stats`,
      );
      if (!mountedRef.current) return;
      setStats(res);
      setStatsError(false);
    } catch (error) {
      if (!mountedRef.current) return;
      // Zeros are indistinguishable from "this vendor has nothing", so a
      // failed request has to say so rather than quietly render 0.
      console.error("Failed to load vendor stats:", error);
      setStatsError(true);
    } finally {
      if (mountedRef.current) setStatsLoading(false);
    }
  }, [vendorId]);

  /** Re-read everything the page shows outside the tab bodies. */
  const refreshAll = useCallback(
    async (options?: { keepEdits?: boolean }) => {
      setStatsLoading(true);
      await Promise.all([loadVendor(options), loadStats()]);
    },
    [loadStats, loadVendor],
  );

  useEffect(() => {
    let active = true;

    void (async () => {
      await loadVendor();
      if (active) setIsFetching(false);
    })();

    return () => {
      active = false;
    };
  }, [loadVendor]);

  useEffect(() => {
    void (async () => {
      await loadStats();
    })();
  }, [loadStats]);

  // Whether vendor plans are enabled at all (drives the Subscription widget).
  useEffect(() => {
    let active = true;

    apiClient
      .get<{ vendorConfig?: { plansEnabled?: boolean } }>("/api/admin/settings")
      .then((settings) => {
        if (!active) return;
        plansEnabledResolvedRef.current = true;
        setPlansEnabled(Boolean(settings?.vendorConfig?.plansEnabled));
      })
      .catch(() => {
        // Falls back to the subscription-presence heuristic from the vendor
        // payload, which `applyVendor` only applies while this is unresolved.
      });

    return () => {
      active = false;
    };
  }, [vendorId]);

  /**
   * Reconcile a KPI with the count a tab just loaded.
   *
   * The tabs unmount when you switch away, so their tables always refetch —
   * the header does not. Letting them report their totals up keeps the strip
   * honest after a product or order changes elsewhere.
   */
  const syncStat = useCallback((key: keyof VendorStats, total: number) => {
    setStats((prev) =>
      prev && prev[key] === total ? prev : { ...(prev ?? {}), [key]: total },
    );
  }, []);

  const syncProductCount = useCallback(
    (total: number) => syncStat("productCount", total),
    [syncStat],
  );
  const syncOrderCount = useCallback(
    (total: number) => syncStat("orderCount", total),
    [syncStat],
  );

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
    <K extends keyof VendorFormValues>(key: K, value: VendorFormValues[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const confirmDiscard = useCallback(async () => {
    if (!isDirtyRef.current) return true;
    return confirm({
      title: "Discard unsaved changes?",
      description:
        "You have unsaved changes on this vendor. Leaving now will lose them.",
      confirmText: "Discard",
      cancelText: "Keep editing",
      variant: "destructive",
    });
  }, [confirm]);

  const navigateBack = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    router.push(`${basePath}/vendors`);
  }, [basePath, confirmDiscard, router]);

  const handleSubmit = useCallback(async () => {
    if (readOnly) return;
    if (!form.storeName.trim()) {
      toast.error("Store name is required");
      setActiveTab("profile");
      return;
    }
    if (!form.ownerName.trim()) {
      toast.error("Owner name is required");
      setActiveTab("profile");
      return;
    }
    if (!form.ownerEmail.trim()) {
      toast.error("Owner email is required");
      setActiveTab("profile");
      return;
    }
    // No "at least one permission" check any more: access comes from the plan,
    // so an empty override list is the normal, correct state.

    setIsSaving(true);
    try {
      const payload = {
        storeName: form.storeName.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description.trim() || undefined,
        logo: form.logo.trim() || undefined,
        banner: form.banner.trim() || undefined,
        commission: Math.max(0, Math.min(100, Number(form.commission) || 0)),
        codCollectedBy: form.codCollectedBy,
        status: form.status,
        verified: form.verified,
        userStatus: form.userStatus,
        ownerName: form.ownerName.trim(),
        ownerEmail: form.ownerEmail.trim().toLowerCase(),
        ownerPhone: form.ownerPhone.trim() || undefined,
        permissionOverrides: form.permissionOverrides.map((override) => ({
          permission: override.permission,
          mode: override.mode,
          reason: override.reason,
          expiresAt: override.expiresAt ?? null,
        })),
        notes: form.notes.trim() || undefined,
        rejectionReason: form.rejectionReason.trim(),
        address: {
          street: form.addressStreet.trim(),
          city: form.addressCity.trim(),
          state: form.addressState.trim(),
          postalCode: form.addressPostalCode.trim(),
          country: form.addressCountry.trim(),
          phone: form.addressPhone.trim(),
        },
        bankDetails: {
          accountName: form.bankAccountName.trim(),
          accountNumber: form.bankAccountNumber.trim(),
          bankName: form.bankName.trim(),
          routingNumber: form.bankRoutingNumber.trim(),
          swiftCode: form.bankSwiftCode.trim(),
        },
        documents: {
          businessLicense: form.docBusinessLicense.trim(),
          taxId: form.docTaxId.trim(),
          taxCertificate: form.docTaxCertificate.trim(),
          governmentId: form.docGovernmentId.trim(),
        },
      };

      await apiClient.put(`/api/admin/vendors/${vendorId}`, payload);
      toast.success("Vendor updated successfully");
      // Clear the dirty flag first so the guard is released even if the
      // re-read below fails, then take the server's version of the record.
      // It is not always what was sent: slugs get slugified, and an approval
      // that still owes an initial payment is stored as PAYMENT_REQUIRED.
      // Patching the header from the form instead would show a status the
      // database does not have.
      setSavedForm(form);
      await refreshAll();
      router.refresh();
    } catch (error) {
      console.error("Save vendor failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save vendor",
      );
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [form, readOnly, refreshAll, router, vendorId]);

  const handleDelete = useCallback(async () => {
    if (!vendorId || readOnly) return;
    const ok = await confirm({
      title: "Delete vendor",
      description:
        "This removes the vendor profile and reverts the owner role to customer.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    });
    if (!ok) return;

    setIsDeleting(true);
    try {
      await apiClient.delete(`/api/admin/vendors/${vendorId}`);
      toast.success("Vendor deleted successfully");
      setSavedForm(form); // suppress the unsaved-changes guard on navigation
      router.push(`${basePath}/vendors`);
      router.refresh();
    } catch (error) {
      console.error("Delete vendor failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete vendor",
      );
    } finally {
      setIsDeleting(false);
    }
  }, [basePath, confirm, form, readOnly, router, vendorId]);

  // A plan change rewrites the vendor's commission server-side, so the whole
  // record is re-read — but `keepEdits` protects anything typed into the other
  // tabs and not saved yet.
  const refreshSubscription = useCallback(() => {
    const hadEdits = isDirtyRef.current;
    void refreshAll({ keepEdits: true }).then(() => {
      if (hadEdits && mountedRef.current) {
        toast.info(
          "Subscription updated. Your unsaved profile edits were kept — save to apply them.",
        );
      }
    });
  }, [refreshAll]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshAll({ keepEdits: true });
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [refreshAll]);

  const tabs = [
    { value: "profile", label: "Profile", icon: Store },
    { value: "products", label: "Products", icon: Package },
    { value: "orders", label: "Orders", icon: ShoppingBag },
    { value: "payouts", label: "Payouts", icon: Wallet },
    { value: "access", label: "Access", icon: ShieldCheck },
    { value: "subscription", label: "Subscription", icon: CreditCard },
    { value: "business", label: "Business", icon: Landmark },
    { value: "documents", label: "Documents", icon: FileText },
    { value: "activity", label: "Activity", icon: History },
    { value: "notes", label: "Notes", icon: StickyNote },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title="Vendor Details"
        description="View and update vendor profile"
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
              onClick={handleManualRefresh}
              disabled={isFetching || isSaving || isDeleting || isRefreshing}
              title="Reload profile and commerce counts"
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
              <span className="sr-only">Refresh</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={navigateBack}
              disabled={isSaving || isDeleting}
            >
              Back to vendors
            </Button>
          </>
        }
      />

      <VendorDetailHeader
        data={header ?? LOADING_HEADER}
        stats={stats}
        commission={form.commission}
        verified={form.verified}
        loading={isFetching}
        statsLoading={statsLoading}
        statsError={statsError}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
          {tabs.map((tab) => (
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

        <TabsContent value="profile" className="space-y-6">
          {isFetching ? (
            <DetailFormSkeleton />
          ) : (
            <ProfileTab form={form} setField={setField} readOnly={readOnly} />
          )}

          {!isFetching && onboardingResponses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Onboarding responses</CardTitle>
                <CardDescription>
                  Answers to custom onboarding fields
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  {onboardingResponses.map((r) => (
                    <div key={r.key} className="flex gap-3 text-sm">
                      <dt className="w-40 shrink-0 text-muted-foreground">
                        {r.label}
                      </dt>
                      <dd className="min-w-0 flex-1 break-words">
                        {typeof r.value === "boolean"
                          ? r.value
                            ? "Yes"
                            : "No"
                          : r.value || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="products">
          <ProductsTab
            vendorId={vendorId}
            basePath={basePath}
            onTotalChange={syncProductCount}
          />
        </TabsContent>

        <TabsContent value="orders">
          <OrdersTab
            vendorId={vendorId}
            basePath={basePath}
            onTotalChange={syncOrderCount}
          />
        </TabsContent>

        <TabsContent value="payouts">
          <PayoutsTab vendorId={vendorId} basePath={basePath} />
        </TabsContent>

        <TabsContent value="access">
          {isFetching ? (
            <DetailFormSkeleton cards={1} fieldsPerCard={6} />
          ) : (
            <div className="space-y-6">
              <AccessTab
                form={form}
                setField={setField}
                readOnly={readOnly}
                locale={locale}
                onOpenSubscription={() => setActiveTab("subscription")}
              />
              {/* Saved on its own, not by the page's Save: a grant or a
                  withdrawal is a decision the vendor is notified about. */}
              <VendorPreorderAccessCard
                vendorId={vendorId}
                storeName={form.storeName}
                locale={locale}
                readOnly={readOnly}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="subscription">
          {isFetching ? (
            <DetailFormSkeleton cards={1} fieldsPerCard={4} />
          ) : (
            <SubscriptionTab
              vendorId={vendorId}
              readOnly={readOnly}
              plansEnabled={plansEnabled}
              subscription={subscription}
              onSubscriptionChange={refreshSubscription}
            />
          )}
        </TabsContent>

        <TabsContent value="business">
          {isFetching ? (
            <DetailFormSkeleton cards={1} fieldsPerCard={5} />
          ) : (
            <BusinessTab form={form} setField={setField} readOnly={readOnly} />
          )}
        </TabsContent>

        <TabsContent value="documents">
          {isFetching ? (
            <DetailFormSkeleton cards={1} fieldsPerCard={4} />
          ) : (
            <DocumentsTab form={form} setField={setField} readOnly={readOnly} />
          )}
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTab vendorId={vendorId} />
        </TabsContent>

        <TabsContent value="notes" className="space-y-6">
          {isFetching ? (
            <DetailFormSkeleton cards={1} fieldsPerCard={1} />
          ) : (
            <NotesTab form={form} setField={setField} readOnly={readOnly} />
          )}

          {!isFetching && !readOnly && (
            <Card>
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
                <CardDescription>Delete this vendor profile</CardDescription>
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
                  Delete vendor
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {readOnly && (
        <p className="text-sm text-muted-foreground">
          You have view-only access for this vendor.
        </p>
      )}
    </div>
  );
}
