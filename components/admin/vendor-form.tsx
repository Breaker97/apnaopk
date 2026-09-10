"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaUploader } from "@/components/ui/media-uploader";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import { slugify } from "@/lib/strings";

interface VendorFormProps {
  locale: string;
  vendorId?: string;
}

interface VendorFormValues {
  storeName: string;
  slug: string;
  description: string;
  logo: string;
  banner: string;
  commission: number;
  status: string;
  userStatus: "active" | "inactive" | "banned";
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
}

const defaultValues: VendorFormValues = {
  storeName: "",
  slug: "",
  description: "",
  logo: "",
  banner: "",
  commission: DEFAULT_VENDOR_COMMISSION_RATE,
  status: VENDOR_STATUS.PENDING,
  userStatus: USER_ACCOUNT_STATUS.ACTIVE,
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
};

const VENDOR_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
const VENDOR_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export function VendorForm({ locale, vendorId }: VendorFormProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [isFetching, setIsFetching] = useState(Boolean(vendorId));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<VendorFormValues>(defaultValues);
  // Read-only answers to admin-defined custom onboarding fields (self-describing
  // {label, value}), captured when the vendor applied.
  const [onboardingResponses, setOnboardingResponses] = useState<
    Array<{ key: string; label: string; value: string | boolean }>
  >([]);

  const isEdit = Boolean(vendorId);
  const pageTitle = useMemo(
    () => (isEdit ? "Vendor Details" : "Add Vendor"),
    [isEdit],
  );

  const fetchVendor = useCallback(async () => {
    if (!vendorId) return;
    try {
      const res = await fetch(`/api/admin/vendors/${vendorId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to fetch vendor");
      }
      const vendor = data.data;
      setForm({
        storeName: vendor.storeName || "",
        slug: vendor.slug || "",
        description: vendor.description || "",
        logo: vendor.logo || "",
        banner: vendor.banner || "",
        commission:
          typeof vendor.commission === "number"
            ? vendor.commission
            : DEFAULT_VENDOR_COMMISSION_RATE,
        status: vendor.status || VENDOR_STATUS.PENDING,
        userStatus: vendor.user?.status || USER_ACCOUNT_STATUS.ACTIVE,
        ownerName: vendor.user?.name || "",
        ownerEmail: vendor.user?.email || "",
        ownerPhone: vendor.user?.phone || "",
      });
      const respObj =
        vendor.onboardingResponses &&
        typeof vendor.onboardingResponses === "object"
          ? (vendor.onboardingResponses as Record<
              string,
              { label?: string; value?: string | boolean }
            >)
          : {};
      setOnboardingResponses(
        Object.entries(respObj).map(([key, v]) => ({
          key,
          label: v?.label || key,
          value: v?.value ?? "",
        })),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to fetch vendor",
      );
    } finally {
      setIsFetching(false);
    }
  }, [vendorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchVendor();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fetchVendor]);

  useEffect(() => {
    if (vendorId) return;
    let active = true;
    void fetch("/api/admin/settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        const rate = payload?.data?.orders?.commission?.vendorRate;
        if (active && typeof rate === "number" && Number.isFinite(rate)) {
          setForm((current) => ({ ...current, commission: rate }));
        }
      })
      .catch(() => {
        // The API applies the configured default if settings cannot be loaded.
      });
    return () => {
      active = false;
    };
  }, [vendorId]);

  const setField = <K extends keyof VendorFormValues>(
    key: K,
    value: VendorFormValues[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.storeName.trim()) return toast.error("Store name is required");
    if (!form.ownerName.trim()) return toast.error("Owner name is required");
    if (!form.ownerEmail.trim()) return toast.error("Owner email is required");

    setIsSaving(true);
    try {
      const payload = {
        storeName: form.storeName.trim(),
        slug: slugify(form.slug || form.storeName),
        description: form.description.trim() || undefined,
        logo: form.logo.trim() || undefined,
        banner: form.banner.trim() || undefined,
        commission: Math.max(0, Math.min(100, Number(form.commission) || 0)),
        status: form.status,
        userStatus: form.userStatus,
        ownerName: form.ownerName.trim(),
        ownerEmail: form.ownerEmail.trim().toLowerCase(),
        ownerPhone: form.ownerPhone.trim() || undefined,
      };

      const res = await fetch(
        isEdit ? `/api/admin/vendors/${vendorId}` : "/api/admin/vendors",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to save vendor");
      }
      toast.success(
        isEdit ? "Vendor updated successfully" : "Vendor created successfully",
      );
      if (isEdit) {
        router.refresh();
      } else {
        router.push(`/${locale}/admin/vendors`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save vendor",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!vendorId) return;
    const ok = await confirm({
      title: "Delete vendor",
      description:
        "This removes the vendor profile and reverts the owner role to customer.",
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/vendors/${vendorId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to delete vendor");
      }
      toast.success("Vendor deleted successfully");
      router.push(`/${locale}/admin/vendors`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete vendor",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (isFetching) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={pageTitle}
        description={
          isEdit ? "View and update vendor profile" : "Create a new vendor"
        }
        actions={
          <>
            <Button size="sm" onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {isEdit ? "Save changes" : "Create vendor"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/${locale}/admin/vendors`)}
            >
              Back to vendors
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Store Profile</CardTitle>
              <CardDescription>Public storefront details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="storeName">Store name *</Label>
                <Input
                  id="storeName"
                  value={form.storeName}
                  onChange={(e) => setField("storeName", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Store slug</Label>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => setField("slug", e.target.value)}
                  placeholder="auto-from-store-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Store logo</Label>
                  <MediaUploader
                    value={
                      form.logo
                        ? [
                            {
                              _id: "logo",
                              url: form.logo,
                              type: "image",
                              mimeType: "image/*",
                              alt: `${form.storeName || "Store"} logo`,
                              position: 0,
                            },
                          ]
                        : []
                    }
                    onChange={(items) => {
                      const logo = items.find((item) => item.type === "image");
                      setField("logo", logo?.url || "");
                    }}
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
                  <Label>Store banner</Label>
                  <MediaUploader
                    value={
                      form.banner
                        ? [
                            {
                              _id: "banner",
                              url: form.banner,
                              type: "image",
                              mimeType: "image/*",
                              alt: `${form.storeName || "Store"} banner`,
                              position: 0,
                            },
                          ]
                        : []
                    }
                    onChange={(items) => {
                      const banner = items.find(
                        (item) => item.type === "image",
                      );
                      setField("banner", banner?.url || "");
                    }}
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Access</CardTitle>
              <CardDescription>
                Nothing to configure here. A new vendor holds exactly what their
                plan sells — or the commission-only baseline when no plan governs
                them. Deviations are set per permission on the vendor&apos;s
                Access tab after it is created.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Owner Account</CardTitle>
              <CardDescription>
                User account linked to this vendor
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ownerName">Owner name *</Label>
                <Input
                  id="ownerName"
                  value={form.ownerName}
                  onChange={(e) => setField("ownerName", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerEmail">Owner email *</Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  value={form.ownerEmail}
                  onChange={(e) => setField("ownerEmail", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerPhone">Owner phone</Label>
                <Input
                  id="ownerPhone"
                  value={form.ownerPhone}
                  onChange={(e) => setField("ownerPhone", e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {isEdit && onboardingResponses.length > 0 ? (
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
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Approval and account state</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Vendor status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => setField("status", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VENDOR_STATUS.PENDING}>
                      Pending
                    </SelectItem>
                    <SelectItem
                      value={VENDOR_STATUS.PAYMENT_REQUIRED}
                      disabled={form.status !== VENDOR_STATUS.PAYMENT_REQUIRED}
                    >
                      Payment Required
                    </SelectItem>
                    <SelectItem value={VENDOR_STATUS.APPROVED}>
                      Approved
                    </SelectItem>
                    <SelectItem value={VENDOR_STATUS.SUSPENDED}>
                      Suspended
                    </SelectItem>
                    <SelectItem value={VENDOR_STATUS.REJECTED}>
                      Rejected
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Owner account status</Label>
                <Select
                  value={form.userStatus}
                  onValueChange={(value) =>
                    setField(
                      "userStatus",
                      value as VendorFormValues["userStatus"],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={USER_ACCOUNT_STATUS.ACTIVE}>
                      Active
                    </SelectItem>
                    <SelectItem value={USER_ACCOUNT_STATUS.INACTIVE}>
                      Inactive
                    </SelectItem>
                    <SelectItem value={USER_ACCOUNT_STATUS.BANNED}>
                      Banned
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="commission">Commission %</Label>
                <NumberInput
                  id="commission"
                  min={0}
                  max={100}
                  value={form.commission}
                  whenEmpty={0}
                  onValueChange={(next) => setField("commission", next ?? 0)}
                />
              </div>
            </CardContent>
          </Card>

          {isEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Danger zone</CardTitle>
                <CardDescription>Delete this vendor profile</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Delete vendor
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
