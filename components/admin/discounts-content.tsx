"use client";

import { useCallback, useMemo, useState } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useCurrency } from "@/providers/currency-provider";
import { apiClient } from "@/lib/api/client";
import { useTranslations } from "next-intl";
import {
  CalendarRange,
  ChevronsUpDown,
  Download,
  Pencil,
  Percent,
  Plus,
  Tag,
  TicketPercent,
  Truck,
  Trash2,
  Upload,
  CheckCircle2,
  CircleOff,
} from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  StatusCell,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTableColumn,
  type DataTableTab,
} from "@/components/ui/data-table";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";

type CouponType = "percentage" | "fixed" | "free_shipping";
type CouponStatus = "active" | "inactive" | "expired";

interface AdminCoupon {
  _id: string;
  code: string;
  label?: string;
  description?: string;
  type: CouponType;
  value: number;
  minOrderAmount?: number;
  maxDiscount?: number;
  usageLimit?: number;
  usedCount: number;
  perUserLimit?: number;
  startDate: string;
  endDate: string;
  status: CouponStatus;
}

interface DiscountsContentProps {
  locale: string;
  apiBasePath?: string;
  /** Rows for the current query string, fetched by the page. */
  data: AdminCoupon[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type CouponFormState = {
  code: string;
  label: string;
  description: string;
  type: CouponType;
  value: string;
  minOrderAmount: string;
  maxDiscount: string;
  usageLimit: string;
  perUserLimit: string;
  startDate: string;
  endDate: string;
  status: CouponStatus;
};

const DEFAULT_FORM: CouponFormState = {
  code: "",
  label: "",
  description: "",
  type: "percentage",
  value: "",
  minOrderAmount: "",
  maxDiscount: "",
  usageLimit: "",
  perUserLimit: "",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  status: "active",
};

function getThrowableMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function formatDiscount(
  coupon: AdminCoupon,
  formatPrice: (value: number) => string,
) {
  if (coupon.type === "free_shipping") return "Free shipping";
  if (coupon.type === "percentage") return `${coupon.value}%`;
  return formatPrice(coupon.value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function toFormState(coupon?: AdminCoupon | null): CouponFormState {
  if (!coupon) return DEFAULT_FORM;
  return {
    code: coupon.code,
    label: coupon.label || "",
    description: coupon.description || "",
    type: coupon.type,
    value: String(coupon.value ?? ""),
    minOrderAmount:
      typeof coupon.minOrderAmount === "number" ? String(coupon.minOrderAmount) : "",
    maxDiscount: typeof coupon.maxDiscount === "number" ? String(coupon.maxDiscount) : "",
    usageLimit: typeof coupon.usageLimit === "number" ? String(coupon.usageLimit) : "",
    perUserLimit:
      typeof coupon.perUserLimit === "number" ? String(coupon.perUserLimit) : "",
    startDate: coupon.startDate.slice(0, 10),
    endDate: coupon.endDate.slice(0, 10),
    status: coupon.status,
  };
}

export function DiscountsContent({
  apiBasePath = "/api/admin/coupons",
  data,
  pagination,
}: DiscountsContentProps) {
  const t = useTranslations();
  const tr = useAdminPhrase();
  const { confirm } = useConfirmation();
  const { currency, formatPrice } = useCurrency();
  const currencySymbol = currency?.symbol || currency?.code || "";

  const [selectedCoupons, setSelectedCoupons] = useState<AdminCoupon[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<AdminCoupon | null>(null);
  const [formState, setFormState] = useState<CouponFormState>(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const list = useListNavigation<AdminCoupon>({
    items: data,
    pagination,
  });

  const openCreateDialog = () => {
    setEditingCoupon(null);
    setFormState(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (coupon: AdminCoupon) => {
    setEditingCoupon(coupon);
    setFormState(toFormState(coupon));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (isSaving) return;
    setDialogOpen(false);
  };

  const setField = <K extends keyof CouponFormState>(field: K, value: CouponFormState[K]) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const setDiscountType = (type: CouponType) => {
    setFormState((prev) => ({
      ...prev,
      type,
      value: type === "free_shipping" ? "0" : prev.value === "0" ? "" : prev.value,
    }));
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      code: formState.code.trim().toUpperCase(),
      label: formState.label.trim() || undefined,
      description: formState.description.trim() || undefined,
      type: formState.type,
      value: formState.type === "free_shipping" ? 0 : Number(formState.value),
      startDate: formState.startDate || undefined,
      endDate: formState.endDate,
      status: formState.status,
    };

    if (formState.minOrderAmount) payload.minOrderAmount = Number(formState.minOrderAmount);
    if (formState.maxDiscount) payload.maxDiscount = Number(formState.maxDiscount);
    if (formState.usageLimit) payload.usageLimit = Number(formState.usageLimit);
    if (formState.perUserLimit) payload.perUserLimit = Number(formState.perUserLimit);

    return payload;
  };

  const saveCoupon = async () => {
    if (!formState.code.trim() && !editingCoupon) {
      toast.error(tr("Discount code is required", "ডিসকাউন্ট কোড প্রয়োজন"));
      return;
    }
    if (
      formState.type !== "free_shipping" &&
      (!formState.value || Number(formState.value) <= 0)
    ) {
      toast.error(tr("Discount value must be greater than 0", "ডিসকাউন্ট মান ০ এর বেশি হতে হবে"));
      return;
    }
    if (!formState.endDate) {
      toast.error(tr("End date is required", "শেষ তারিখ প্রয়োজন"));
      return;
    }

    setIsSaving(true);
    try {
      const isEdit = Boolean(editingCoupon);
      const endpoint = isEdit
        ? `${apiBasePath}/${editingCoupon?._id}`
        : apiBasePath;

      const payload = buildPayload();

      if (isEdit) {
        delete payload.code;
      }

      if (isEdit) {
        await apiClient.put(endpoint, payload);
      } else {
        await apiClient.post(endpoint, payload);
      }

      toast.success(isEdit ? tr("Discount updated", "ডিসকাউন্ট আপডেট হয়েছে") : tr("Discount created", "ডিসকাউন্ট তৈরি হয়েছে"));
      setDialogOpen(false);
      list.refetch();
    } catch (error: unknown) {
      toast.error(getThrowableMessage(error, tr("Failed to save discount", "ডিসকাউন্ট সংরক্ষণ করা যায়নি")));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCoupon = useCallback(
    async (coupon: AdminCoupon) => {
      const confirmed = await confirm({
        title: tr("Delete Discount", "ডিসকাউন্ট মুছুন"),
        description: tr(
          `Are you sure you want to delete \"${coupon.code}\"? This action cannot be undone.`,
          `আপনি কি \"${coupon.code}\" মুছতে চান? এই কাজটি ফিরিয়ে আনা যাবে না।`,
        ),
        confirmText: tr("Delete", "মুছুন"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`${apiBasePath}/${coupon._id}`);
        toast.success(tr("Discount deleted", "ডিসকাউন্ট মুছে ফেলা হয়েছে"));
        list.refetch();
      } catch (error: unknown) {
        toast.error(getThrowableMessage(error, tr("Failed to delete discount", "ডিসকাউন্ট মুছতে ব্যর্থ")));
      }
    },
    [apiBasePath, confirm, list, tr],
  );

  const handleBulkDelete = useCallback(
    async (items: AdminCoupon[]) => {
      const confirmed = await confirm({
        title: tr("Delete Discounts", "ডিসকাউন্টসমূহ মুছুন"),
        description: t("admin.discountsDataTable.deleteBulkDescription", {
          count: items.length,
        }),
        confirmText: tr("Delete", "মুছুন"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: "destructive",
      });

      if (!confirmed) return;

      const results = await Promise.allSettled(
        items.map((coupon) => apiClient.delete(`${apiBasePath}/${coupon._id}`)),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedCoupons([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(t("admin.discountsDataTable.deleteBulkSuccess", { count: successCount }));
      }
      if (failCount > 0) {
        toast.error(t("admin.discountsDataTable.deleteBulkError", { count: failCount }));
      }
    },
    [apiBasePath, confirm, list, t, tr],
  );

  const handleBulkStatusUpdate = useCallback(
    async (items: AdminCoupon[], status: CouponStatus) => {
      const confirmed = await confirm({
        title: tr("Update Discount Status", "ডিসকাউন্ট স্ট্যাটাস আপডেট"),
        description: t("admin.discountsDataTable.updateStatusDescription", {
          count: items.length,
          status,
        }),
        confirmText: tr("Update", "আপডেট"),
        cancelText: tr("Cancel", "বাতিল"),
      });

      if (!confirmed) return;

      const results = await Promise.allSettled(
        items.map((coupon) =>
          apiClient.put(`${apiBasePath}/${coupon._id}`, { status }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedCoupons([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(t("admin.discountsDataTable.updateSuccess", { count: successCount }));
      }
      if (failCount > 0) {
        toast.error(t("admin.discountsDataTable.updateError", { count: failCount }));
      }
    },
    [apiBasePath, confirm, list, t, tr],
  );

  const columns = useMemo<DataTableColumn<AdminCoupon>[]>(
    () => [
      {
        id: "code",
        header: tr("Discount", "ডিসকাউন্ট"),
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.code}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.label || row.description || tr("No label", "কোনো লেবেল নেই")}
            </p>
          </div>
        ),
        className: "w-[300px]",
      },
      {
        id: "type",
        header: tr("Type", "ধরন"),
        cell: (row) => (
          <Badge variant="outline" className="w-fit capitalize">
            {row.type === "percentage" ? (
              <>
                <Percent className="mr-1 h-3 w-3" />
                {tr("Percentage", "শতাংশ")}
              </>
            ) : row.type === "free_shipping" ? (
              <>
                <Truck className="mr-1 h-3 w-3" />
                {tr("Free shipping", "ফ্রি শিপিং")}
              </>
            ) : (
              <>
                <TicketPercent className="mr-1 h-3 w-3" />
                {tr("Fixed", "নির্দিষ্ট")}
              </>
            )}
          </Badge>
        ),
        className: "w-[130px]",
      },
      {
        id: "value",
        header: tr("Value", "মান"),
        cell: (row) => formatDiscount(row, formatPrice),
        className: "w-[100px]",
      },
      {
        id: "status",
        header: tr("Status", "স্ট্যাটাস"),
        cell: (row) => (
          <StatusCell
            status={row.status}
            statusMap={{
              active: { label: tr("Active", "সক্রিয়"), variant: "default" },
              inactive: { label: tr("Inactive", "নিষ্ক্রিয়"), variant: "outline" },
              expired: { label: tr("Expired", "মেয়াদোত্তীর্ণ"), variant: "destructive" },
            }}
          />
        ),
        className: "w-[120px]",
      },
      {
        id: "usage",
        header: tr("Usage", "ব্যবহার"),
        cell: (row) => (
          <span>
            {row.usedCount}
            {row.usageLimit ? ` / ${row.usageLimit}` : ""}
          </span>
        ),
        className: "w-[130px]",
      },
      {
        id: "schedule",
        header: tr("Schedule", "সময়সূচি"),
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.startDate)} - {formatDate(row.endDate)}
          </span>
        ),
        className: "w-[220px]",
      },
    ],
    [tr, formatPrice],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: tr("All", "সব") },
      { id: "active", label: tr("Active", "সক্রিয়") },
      { id: "inactive", label: tr("Inactive", "নিষ্ক্রিয়") },
      { id: "expired", label: tr("Expired", "মেয়াদোত্তীর্ণ") },
    ],
    [tr],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: tr("Discounts", "ডিসকাউন্ট"),
        addAction: {
          id: "add",
          label: tr("Add discount", "ডিসকাউন্ট যোগ করুন"),
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
          onClick: openCreateDialog,
        },
        importExportAction: {
          id: "import-export",
          label: t("admin.productsDataTable.actions.importExport"),
          icon: <ChevronsUpDown className="h-4 w-4" />,
          variant: "outline",
          items: [
            {
              id: "toolbar-export",
              label: tr("Export", "এক্সপোর্ট"),
              icon: <Download className="h-4 w-4" />,
              onClick: () =>
                toast.info(
                  tr(
                    "Export will be available soon",
                    "এক্সপোর্ট খুব শিগগিরই উপলভ্য হবে",
                  ),
                ),
            },
            {
              id: "toolbar-import",
              label: tr("Import", "ইম্পোর্ট"),
              icon: <Upload className="h-4 w-4" />,
              onClick: () =>
                toast.info(
                  tr(
                    "Import will be available soon",
                    "ইম্পোর্ট খুব শিগগিরই উপলভ্য হবে",
                  ),
                ),
            },
          ],
        },
      }),
    [tr, t],
  );

  const bulkActions = useMemo<DataTableBulkAction<AdminCoupon>[]>(
    () => [
      {
        id: "set-active",
        label: tr("Set active", "সক্রিয় করুন"),
        icon: <CheckCircle2 className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatusUpdate(items, "active"),
      },
      {
        id: "set-inactive",
        label: tr("Set inactive", "নিষ্ক্রিয় করুন"),
        icon: <CircleOff className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatusUpdate(items, "inactive"),
      },
      {
        id: "delete",
        label: tr("Delete", "মুছুন"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: handleBulkDelete,
      },
    ],
    [handleBulkDelete, handleBulkStatusUpdate, tr],
  );

  const rowActions = useCallback(
    (row: AdminCoupon): DataTableAction[] => [
      {
        id: "edit",
        label: tr("Edit", "এডিট"),
        icon: <Pencil className="h-4 w-4" />,
        onClick: () => openEditDialog(row),
      },
      {
        id: "delete",
        label: tr("Delete", "মুছুন"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => {
          void deleteCoupon(row);
        },
      },
    ],
    [deleteCoupon, tr],
  );

  return (
    <>
      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        isLoading={list.isLoading}
        loadingMode="rows"
      title={tableHeader.title}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        actions={tableHeader.actions}
        selectable
        selectedItems={selectedCoupons}
        onSelectionChange={setSelectedCoupons}
        bulkActions={bulkActions}
        searchable
        searchPlaceholder={tr("Search code, label, or description", "কোড, লেবেল বা বর্ণনা দিয়ে খুঁজুন")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        toolbarActions={tableHeader.toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        rowActions={rowActions}
        rowActionsHeader={tr("Actions", "অ্যাকশন")}
        rowActionsVariant="inline"
        emptyMessage={tr("No discounts found", "কোনো ডিসকাউন্ট পাওয়া যায়নি")}
        emptyIcon={<TicketPercent className="h-8 w-8" />}
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="w-[calc(100%-1rem)] max-h-[92vh] overflow-hidden p-0 sm:max-w-2xl">
          <div className="flex h-full max-h-[92vh] flex-col">
            <DialogHeader className="px-6 pt-6 pb-2">
              <DialogTitle>{editingCoupon ? tr("Edit Discount", "ডিসকাউন্ট এডিট") : tr("Create Discount", "ডিসকাউন্ট তৈরি")}</DialogTitle>
              <DialogDescription>
                {tr("Configure discount rules similar to Shopify coupon settings.", "Shopify-স্টাইল কুপন সেটিংস অনুযায়ী ডিসকাউন্ট নিয়ম কনফিগার করুন।")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-6 pb-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="discount-code">{tr("Code", "কোড")}</Label>
                  <Input
                    id="discount-code"
                    value={formState.code}
                    onChange={(e) => setField("code", e.target.value.toUpperCase())}
                    placeholder={tr("SUMMER10", "SUMMER10")}
                    disabled={Boolean(editingCoupon)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-label">{tr("Label", "লেবেল")}</Label>
                  <Input
                    id="discount-label"
                    value={formState.label}
                    onChange={(e) => setField("label", e.target.value)}
                    placeholder={tr("Flash Sale", "ফ্ল্যাশ সেল")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-status">{tr("Status", "স্ট্যাটাস")}</Label>
                  <NativeSelect
                    id="discount-status"
                    value={formState.status}
                    onChange={(e) => setField("status", e.target.value as CouponStatus)}
                    className="w-full"
                  >
                    <option value="active">{tr("Active", "সক্রিয়")}</option>
                    <option value="inactive">{tr("Inactive", "নিষ্ক্রিয়")}</option>
                    <option value="expired">{tr("Expired", "মেয়াদোত্তীর্ণ")}</option>
                  </NativeSelect>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="discount-type">{tr("Type", "ধরন")}</Label>
                  <NativeSelect
                    id="discount-type"
                    value={formState.type}
                    onChange={(e) => setDiscountType(e.target.value as CouponType)}
                    className="w-full"
                  >
                    <option value="percentage">{tr("Percentage", "শতাংশ")}</option>
                    <option value="fixed">{tr("Fixed amount", "নির্দিষ্ট পরিমাণ")}</option>
                    <option value="free_shipping">{tr("Free shipping", "ফ্রি শিপিং")}</option>
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-value">{tr("Value", "মান")}</Label>
                  {/* A fixed-amount discount is money, a percentage one is not
                      — the prefix follows the selected type rather than always
                      showing a currency. */}
                  <CurrencyInput
                    id="discount-value"
                    currencySymbol={
                      formState.type === "percentage" ? "%" : currencySymbol
                    }
                    min="0"
                    step="0.01"
                    value={formState.type === "free_shipping" ? "0" : formState.value}
                    onChange={(e) => setField("value", e.target.value)}
                    placeholder={
                      formState.type === "free_shipping"
                        ? tr("Not needed", "প্রয়োজন নেই")
                        : formState.type === "percentage"
                          ? "10"
                          : "25.00"
                    }
                    disabled={formState.type === "free_shipping"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="discount-min-order">{tr("Minimum order amount", "ন্যূনতম অর্ডার পরিমাণ")}</Label>
                  <CurrencyInput
                    id="discount-min-order"
                    currencySymbol={currencySymbol}
                    min="0"
                    step="0.01"
                    value={formState.minOrderAmount}
                    onChange={(e) => setField("minOrderAmount", e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-max">{tr("Maximum discount cap", "সর্বোচ্চ ডিসকাউন্ট সীমা")}</Label>
                  <CurrencyInput
                    id="discount-max"
                    currencySymbol={currencySymbol}
                    min="0"
                    step="0.01"
                    value={formState.maxDiscount}
                    onChange={(e) => setField("maxDiscount", e.target.value)}
                    placeholder={tr("Optional", "ঐচ্ছিক")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="discount-usage-limit">{tr("Total usage limit", "মোট ব্যবহার সীমা")}</Label>
                  <Input
                    id="discount-usage-limit"
                    type="number"
                    min="1"
                    step="1"
                    value={formState.usageLimit}
                    onChange={(e) => setField("usageLimit", e.target.value)}
                    placeholder={tr("Optional", "ঐচ্ছিক")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-user-limit">{tr("Per-customer usage limit", "প্রতি গ্রাহক ব্যবহার সীমা")}</Label>
                  <Input
                    id="discount-user-limit"
                    type="number"
                    min="1"
                    step="1"
                    value={formState.perUserLimit}
                    onChange={(e) => setField("perUserLimit", e.target.value)}
                    placeholder={tr("Optional", "ঐচ্ছিক")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="discount-start-date">{tr("Start date", "শুরুর তারিখ")}</Label>
                  <Input
                    id="discount-start-date"
                    type="date"
                    value={formState.startDate}
                    onChange={(e) => setField("startDate", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-end-date">{tr("End date", "শেষ তারিখ")}</Label>
                  <Input
                    id="discount-end-date"
                    type="date"
                    value={formState.endDate}
                    onChange={(e) => setField("endDate", e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="discount-description">{tr("Description", "বর্ণনা")}</Label>
                  <Input
                    id="discount-description"
                    value={formState.description}
                    onChange={(e) => setField("description", e.target.value)}
                    placeholder={tr("Optional internal note for this discount", "এই ডিসকাউন্টের জন্য ঐচ্ছিক অভ্যন্তরীণ নোট")}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-1 rounded-md border p-3 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  {tr("Code will be normalized to uppercase.", "কোড স্বয়ংক্রিয়ভাবে বড় হাতের অক্ষরে রূপান্তরিত হবে।")}
                </p>
                <p className="flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  {tr("Tax is calculated after discount during checkout.", "চেকআউটে ডিসকাউন্টের পর ট্যাক্স গণনা করা হয়।")}
                </p>
                <p className="flex items-center gap-2">
                  <CalendarRange className="h-4 w-4" />
                  {tr("Expired codes are automatically rejected in checkout validation.", "মেয়াদোত্তীর্ণ কোড চেকআউট ভ্যালিডেশনে স্বয়ংক্রিয়ভাবে বাতিল হয়।")}
                </p>
              </div>
            </div>

            <DialogFooter className="border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={isSaving}>
                {tr("Cancel", "বাতিল")}
              </Button>
              <Button type="button" onClick={saveCoupon} disabled={isSaving}>
                {isSaving
                  ? tr("Saving...", "সংরক্ষণ হচ্ছে...")
                  : editingCoupon
                    ? tr("Update Discount", "ডিসকাউন্ট আপডেট")
                    : tr("Create Discount", "ডিসকাউন্ট তৈরি")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
