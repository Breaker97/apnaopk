"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Edit3,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { AppImage } from "@/components/ui/app-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useAppSettings } from "@/providers/app-settings-provider";
import { CountrySelect } from "@/components/common/country-multi-select";
import {
  getAllowedCountryOptions,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type ProductVariant = {
  _id?: string;
  name?: string;
  sku?: string;
  price?: number;
  stock?: number;
  image?: string;
};

type ProductSummary = {
  _id: string;
  name?: string;
  title?: string;
  sku?: string;
  price?: number;
  stock?: number;
  images?: string[];
  variants?: ProductVariant[];
};

type ProductOption = {
  key: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  sku: string;
  price: number;
  stock: number;
  image?: string;
};

type OrderLine = ProductOption & {
  quantity: number;
};

type Customer = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  shippingAddress?: Partial<ShippingAddress>;
};

type ShippingAddress = {
  firstName: string;
  lastName: string;
  street: string;
  apartment: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
};

type CreateCustomerFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  shippingStreet: string;
  shippingApartment: string;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;
  shippingPhone: string;
  tagsInput: string;
  notes: string;
};

type OrderCreateFormVariant = "admin" | "vendor";

interface OrderCreateFormProps {
  locale: string;
  /**
   * Which dashboard hosts the form. Drives the API namespace
   * (`/api/admin/*` vs `/api/vendor/*`) and post-save redirects.
   */
  variant: OrderCreateFormVariant;
}

function emptyAddress(country: string): ShippingAddress {
  return {
    firstName: "",
    lastName: "",
    street: "",
    apartment: "",
    city: "",
    state: "",
    postalCode: "",
    country,
    phone: "",
  };
}

function emptyCreateCustomerForm(country: string): CreateCustomerFormValues {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    shippingStreet: "",
    shippingApartment: "",
    shippingCity: "",
    shippingState: "",
    shippingPostalCode: "",
    shippingCountry: country,
    shippingPhone: "",
    tagsInput: "",
    notes: "",
  };
}

function readApiMessage(data: unknown) {
  if (!data || typeof data !== "object") return "Something went wrong";
  const record = data as Record<string, unknown>;
  return String(record.message || record.error || "Something went wrong");
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function parseCsvTags(input: string) {
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

function mapCustomerProfileToCustomer(profile: unknown): Customer | null {
  const record = asRecord(profile);
  if (!record) return null;
  const user = asRecord(record.user) || asRecord(record.userId);
  const userId =
    user?._id ||
    (typeof record.userId === "string" ? record.userId : undefined);
  const id = String(userId || "");
  if (!id) return null;

  return {
    id,
    name: String(user?.name || "Customer"),
    email: String(user?.email || ""),
    phone: String(user?.phone || ""),
    shippingAddress: (() => {
      const address = asRecord(record.shippingAddress);
      if (!address) return undefined;
      return {
        firstName: String(address.firstName || ""),
        lastName: String(address.lastName || ""),
        street: String(address.street || ""),
        apartment: String(address.apartment || ""),
        city: String(address.city || ""),
        state: String(address.state || ""),
        postalCode: String(address.postalCode || ""),
        country: String(address.country || ""),
        phone: String(address.phone || ""),
      };
    })(),
  };
}

function getProductImage(product: ProductSummary, variant?: ProductVariant) {
  return variant?.image || product.images?.[0];
}

function variantLabel(variant?: ProductVariant) {
  if (!variant?.name || variant.name === "Default Title") return undefined;
  return variant.name;
}

function flattenProductOptions(products: ProductSummary[]): ProductOption[] {
  return products.flatMap((product) => {
    const name = product.title || product.name || "Untitled product";
    const variants = product.variants || [];

    if (variants.length > 0) {
      return variants.map((variant) => ({
        key: `${product._id}:${variant._id || variant.name || "variant"}`,
        productId: product._id,
        variantId: variant._id,
        productName: name,
        variantName: variantLabel(variant),
        sku: variant.sku || product.sku || "",
        price: Number(variant.price ?? product.price ?? 0),
        stock: Number(variant.stock ?? 0),
        image: getProductImage(product, variant),
      }));
    }

    return [
      {
        key: `${product._id}:default`,
        productId: product._id,
        productName: name,
        sku: product.sku || "",
        price: Number(product.price ?? 0),
        stock: Number(product.stock ?? 0),
        image: getProductImage(product),
      },
    ];
  });
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export function OrderCreateForm({ locale, variant }: OrderCreateFormProps) {
  const router = useRouter();
  const { formatPrice, currency } = useCurrency();
  const { countryAvailability } = useAppSettings();
  const defaultCountry = useMemo(() => {
    if (isCountryAllowed("United States", countryAvailability)) {
      return "United States";
    }
    return getAllowedCountryOptions(countryAvailability)[0]?.label || "";
  }, [countryAvailability]);
  const apiBase = `/api/${variant}`;
  const ordersPath = `/${locale}/${variant}/orders`;

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [selectedProductKeys, setSelectedProductKeys] = useState<string[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [createCustomerDialogOpen, setCreateCustomerDialogOpen] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [createCustomerForm, setCreateCustomerForm] = useState<CreateCustomerFormValues>(
    () => emptyCreateCustomerForm(defaultCountry),
  );

  const [lines, setLines] = useState<OrderLine[]>([]);
  const [shippingAddress, setShippingAddress] = useState<ShippingAddress>(() =>
    emptyAddress(defaultCountry),
  );
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [discount, setDiscount] = useState("0");
  const [shippingCost, setShippingCost] = useState("0");
  const [taxRate, setTaxRate] = useState("0");
  const [paymentDueLater, setPaymentDueLater] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const productOptions = useMemo(() => flattenProductOptions(products), [products]);
  const subtotal = useMemo(
    () => lines.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [lines],
  );
  const numericDiscount = Math.min(Number(discount) || 0, subtotal);
  const numericShipping = Number(shippingCost) || 0;
  const numericTaxRate = Number(taxRate) || 0;
  const taxableSubtotal = Math.max(subtotal - numericDiscount, 0);
  const tax = Math.round(taxableSubtotal * (numericTaxRate / 100) * 100) / 100;
  const total = Math.round((taxableSubtotal + numericShipping + tax) * 100) / 100;
  const hasDraftChanges =
    lines.length > 0 ||
    Boolean(selectedCustomer) ||
    notes.trim().length > 0 ||
    tags.trim().length > 0;

  // Typing in either picker fires a request per debounce window, and those can
  // come back out of order — a slow response for "sh" landing after "shirt"
  // would leave the list showing results for a query the admin has moved past.
  // Each fetch claims a ticket and only the newest one may touch state.
  const productRequestRef = useRef(0);
  const customerRequestRef = useRef(0);

  useApplyOnChange([countryAvailability, defaultCountry], () => {
    setShippingAddress((current) =>
      current.country.trim() &&
      isCountryAllowed(current.country, countryAvailability)
        ? current
        : { ...current, country: defaultCountry },
    );
    setCreateCustomerForm((current) =>
      current.shippingCountry.trim() &&
      isCountryAllowed(current.shippingCountry, countryAvailability)
        ? current
        : { ...current, shippingCountry: defaultCountry },
    );
  });

  const fetchProducts = useCallback(async (search: string) => {
    const requestId = ++productRequestRef.current;
    setIsLoadingProducts(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "50",
        status: "active",
        sortOrder: "desc",
      });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`${apiBase}/products?${params.toString()}`);
      const data = await response.json();
      if (requestId !== productRequestRef.current) return;
      if (!response.ok || data.success === false) {
        throw new Error(readApiMessage(data));
      }
      setProducts(data.data?.data || []);
    } catch (error) {
      if (requestId !== productRequestRef.current) return;
      toast.error(error instanceof Error ? error.message : "Products could not be loaded");
    } finally {
      if (requestId === productRequestRef.current) setIsLoadingProducts(false);
    }
  }, [apiBase]);

  const fetchCustomers = useCallback(async (search: string) => {
    const requestId = ++customerRequestRef.current;
    setIsLoadingCustomers(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "8",
        sortOrder: "desc",
      });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`${apiBase}/customers?${params.toString()}`);
      const data = await response.json();
      if (requestId !== customerRequestRef.current) return;
      if (!response.ok || data.success === false) {
        throw new Error(readApiMessage(data));
      }

      const customerProfiles: unknown[] = Array.isArray(data.data?.data)
        ? data.data.data
        : [];
      const nextCustomers = customerProfiles
        .map((profile: unknown) => mapCustomerProfileToCustomer(profile))
        .filter((customer: Customer | null): customer is Customer =>
          Boolean(customer?.id),
        );
      setCustomers(nextCustomers);
    } catch (error) {
      if (requestId !== customerRequestRef.current) return;
      toast.error(error instanceof Error ? error.message : "Customers could not be loaded");
    } finally {
      if (requestId === customerRequestRef.current) setIsLoadingCustomers(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (!productDialogOpen) return;
    const timer = window.setTimeout(() => {
      void fetchProducts(productSearch);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchProducts, productDialogOpen, productSearch]);

  useEffect(() => {
    if (!customerMenuOpen) return;
    const timer = window.setTimeout(() => {
      void fetchCustomers(customerQuery);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerMenuOpen, customerQuery, fetchCustomers]);

  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerQuery(customer.name);
    setCustomerMenuOpen(false);
    const name = splitName(customer.name);
    setShippingAddress((current) => {
      const customerCountry = customer.shippingAddress?.country || "";
      return {
        ...current,
      firstName:
        current.firstName || customer.shippingAddress?.firstName || name.firstName,
      lastName:
        current.lastName || customer.shippingAddress?.lastName || name.lastName,
      street: current.street || customer.shippingAddress?.street || "",
      apartment: current.apartment || customer.shippingAddress?.apartment || "",
      city: current.city || customer.shippingAddress?.city || "",
      state: current.state || customer.shippingAddress?.state || "",
      postalCode: current.postalCode || customer.shippingAddress?.postalCode || "",
      country:
        customerCountry.trim() &&
        isCountryAllowed(customerCountry, countryAvailability)
        ? customerCountry
        : current.country.trim() &&
            isCountryAllowed(current.country, countryAvailability)
          ? current.country
          : defaultCountry,
      phone:
        current.phone ||
        customer.shippingAddress?.phone ||
        customer.phone ||
        "",
      };
    });
  };

  const setCreateCustomerField = <K extends keyof CreateCustomerFormValues>(
    key: K,
    value: CreateCustomerFormValues[K],
  ) => {
    setCreateCustomerForm((current) => ({ ...current, [key]: value }));
  };

  const openCreateCustomerModal = () => {
    const trimmedQuery = customerQuery.trim();
    const fromQuery = splitName(
      trimmedQuery.includes("@") ? "" : trimmedQuery,
    );
    setCreateCustomerForm((current) => ({
      ...current,
      firstName: current.firstName || fromQuery.firstName,
      lastName: current.lastName || fromQuery.lastName,
      email:
        current.email || (trimmedQuery.includes("@") ? trimmedQuery : ""),
    }));
    setCustomerMenuOpen(false);
    setCreateCustomerDialogOpen(true);
  };

  const handleCreateCustomer = async () => {
    const firstName = createCustomerForm.firstName.trim();
    const lastName = createCustomerForm.lastName.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const email = createCustomerForm.email.trim().toLowerCase();
    const phone = createCustomerForm.phone.trim();
    const shippingStreet = createCustomerForm.shippingStreet.trim();
    const shippingCity = createCustomerForm.shippingCity.trim();
    const shippingPostalCode = createCustomerForm.shippingPostalCode.trim();
    const shippingCountry = createCustomerForm.shippingCountry.trim();
    const notesValue = createCustomerForm.notes.trim();
    const tags = parseCsvTags(createCustomerForm.tagsInput);
    const shippingAddress = {
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      street: shippingStreet,
      apartment: createCustomerForm.shippingApartment.trim() || undefined,
      city: shippingCity,
      state: createCustomerForm.shippingState.trim() || undefined,
      postalCode: shippingPostalCode,
      country: shippingCountry,
      phone: (createCustomerForm.shippingPhone.trim() || phone || undefined),
      isDefault: true,
      label: "home",
    };

    if (!fullName) {
      toast.error("First name or last name is required");
      return;
    }
    if (!email) {
      toast.error("Email is required");
      return;
    }
    if (!shippingStreet || !shippingCity || !shippingPostalCode || !shippingCountry) {
      toast.error("Shipping street, city, postal code, and country are required");
      return;
    }

    setIsCreatingCustomer(true);
    try {
      const response = await fetch(`${apiBase}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fullName,
          email,
          phone: phone || undefined,
          status: "active",
          tags,
          notes: notesValue || undefined,
          shippingAddress,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || data?.success === false) {
        throw new Error(readApiMessage(data));
      }

      const createdCustomer = mapCustomerProfileToCustomer(data?.data?.profile) || {
        id: "",
        name: fullName,
        email,
        phone,
      };
      if (!createdCustomer.id) {
        throw new Error("Customer created but could not be selected");
      }

      setCustomers((current) => [
        createdCustomer,
        ...current.filter((item) => item.id !== createdCustomer.id),
      ]);
      handleSelectCustomer(createdCustomer);
      setCreateCustomerForm(emptyCreateCustomerForm(defaultCountry));
      setCreateCustomerDialogOpen(false);
      toast.success("Customer created successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Customer could not be created",
      );
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  const handleAddSelectedProducts = () => {
    const selected = productOptions.filter((option) =>
      selectedProductKeys.includes(option.key),
    );

    setLines((current) => {
      const next = [...current];
      for (const option of selected) {
        const existing = next.find((line) => line.key === option.key);
        if (existing) {
          existing.quantity += 1;
        } else {
          next.push({ ...option, quantity: 1 });
        }
      }
      return next;
    });

    setSelectedProductKeys([]);
    setProductDialogOpen(false);
  };

  const updateLineQuantity = (key: string, quantity: number) => {
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, quantity: Math.max(1, Math.min(999, quantity || 1)) }
          : line,
      ),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const updateAddress = (field: keyof ShippingAddress, value: string) => {
    setShippingAddress((current) => ({ ...current, [field]: value }));
  };

  const saveOrder = async (markAsPaid: boolean) => {
    if (!selectedCustomer) {
      toast.error("Select a customer before creating the order");
      return;
    }
    if (lines.length === 0) {
      toast.error("Add at least one product");
      return;
    }
    if (
      !shippingAddress.street.trim() ||
      !shippingAddress.city.trim() ||
      !shippingAddress.postalCode.trim() ||
      !shippingAddress.country.trim()
    ) {
      toast.error("Add a shipping address for this order");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${apiBase}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          items: lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
          shippingAddress,
          paymentMethod: markAsPaid ? "manual" : "manual_pending",
          paymentStatus: markAsPaid ? "paid" : "pending",
          shippingCost: numericShipping,
          discount: numericDiscount,
          taxRate: numericTaxRate,
          notes: notes.trim() || undefined,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.success === false) {
        throw new Error(readApiMessage(data));
      }
      toast.success(markAsPaid ? "Order marked as paid" : "Draft order saved");
      router.push(`${ordersPath}/${data.data?._id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order could not be created");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveOrder(false);
      }}
      className="space-y-6 -mx-2 md:mx-0"
    >
      <AdminFormStickyHeader
        title="Create order"
        description={hasDraftChanges ? "Unsaved draft order" : "New draft order"}
        flushWithAdminShell
        status={
          <Badge variant="outline" className="shrink-0">
            Draft
          </Badge>
        }
        actions={
          <>
            <Button
              type="submit"
              size="sm"
              disabled={isSaving || !hasDraftChanges}
            >
              {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push(ordersPath)}
              disabled={isSaving}
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-sm">Products</CardTitle>
              <CardAction className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setProductDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add product
                </Button>
                <Button type="button" variant="outline" size="sm" disabled>
                  <Plus className="h-4 w-4" />
                  Add custom item
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.length > 0 ? (
                lines.map((line) => (
                  <div
                    key={line.key}
                    className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_92px_120px_32px] sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted">
                        <AppImage
                          src={line.image}
                          alt={line.productName}
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {line.productName}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          {line.variantName ? (
                            <Badge variant="secondary" className="rounded-sm px-1.5">
                              {line.variantName}
                            </Badge>
                          ) : null}
                          {line.sku ? <span>{line.sku}</span> : null}
                        </div>
                      </div>
                    </div>
                    <NumberInput
                      min={1}
                      max={999}
                      step={1}
                      value={line.quantity}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next !== undefined) updateLineQuantity(line.key, next);
                      }}
                      aria-label={`Quantity for ${line.productName}`}
                    />
                    <div className="text-right text-sm">
                      <div className="font-medium">
                        {formatPrice(line.price * line.quantity)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatPrice(line.price)} each
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeLine(line.key)}
                      aria-label={`Remove ${line.productName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No products added yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-sm">Payment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <PaymentRow label="Subtotal" detail={`${lines.length} item${lines.length === 1 ? "" : "s"}`} value={formatPrice(subtotal)} />
                <PaymentInputRow label="Add discount" value={discount} onChange={setDiscount} prefix={currency.symbol} />
                <PaymentInputRow label="Add shipping or delivery" value={shippingCost} onChange={setShippingCost} prefix={currency.symbol} />
                <PaymentInputRow label="Estimated tax" value={taxRate} onChange={setTaxRate} suffix="% VAT" />
                <PaymentRow label="Total" value={formatPrice(total)} strong />
                <div className="flex items-center gap-2 border-t px-4 py-3 text-sm">
                  <Checkbox
                    checked={paymentDueLater}
                    onCheckedChange={setPaymentDueLater}
                  />
                  <span>Payment due later</span>
                </div>
              </div>
            </CardContent>
            <div className="flex flex-col gap-3 px-6 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {lines.length > 0
                  ? "Send an invoice or mark this manual order as paid."
                  : "Add a product to calculate total and view payment options."}
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={lines.length === 0}>
                  Send invoice
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void saveOrder(!paymentDueLater)}
                  disabled={isSaving || lines.length === 0}
                >
                  {paymentDueLater ? "Save order" : "Mark as paid"}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <SideCard title="Notes" actionIcon={<Edit3 className="h-4 w-4" />}>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="No notes"
              className="min-h-12 resize-none border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </SideCard>

          <SideCard title="Customer">
            <div className="relative">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={customerQuery}
                  onFocus={() => setCustomerMenuOpen(true)}
                  onChange={(event) => {
                    setCustomerQuery(event.target.value);
                    setCustomerMenuOpen(true);
                    setSelectedCustomer(null);
                  }}
                  placeholder="Search or create a customer"
                  className="pl-9"
                />
              </div>
              {customerMenuOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-md border bg-popover shadow-lg">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={openCreateCustomerModal}
                    className="flex w-full items-center gap-2 bg-muted px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Plus className="h-4 w-4" />
                    Create a new customer
                  </button>
                  <div className="max-h-64 overflow-auto py-1">
                    {isLoadingCustomers ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading customers
                      </div>
                    ) : customers.length > 0 ? (
                      customers.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSelectCustomer(customer)}
                          className="block w-full px-3 py-2 text-left hover:bg-accent"
                        >
                          <div className="text-sm font-medium">{customer.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {customer.email}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-sm text-muted-foreground">
                        No customers found
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {selectedCustomer ? (
              <div className="mt-3 rounded-md bg-muted p-3 text-sm">
                <div className="font-medium">{selectedCustomer.name}</div>
                <div className="text-muted-foreground">{selectedCustomer.email}</div>
              </div>
            ) : null}
          </SideCard>

          {selectedCustomer ? (
            <SideCard title="Shipping address">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="First name" value={shippingAddress.firstName} onChange={(event) => updateAddress("firstName", event.target.value)} />
                <Input placeholder="Last name" value={shippingAddress.lastName} onChange={(event) => updateAddress("lastName", event.target.value)} />
              </div>
              <Input placeholder="Street address" value={shippingAddress.street} onChange={(event) => updateAddress("street", event.target.value)} />
              <Input placeholder="Apartment, suite, etc." value={shippingAddress.apartment} onChange={(event) => updateAddress("apartment", event.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="City" value={shippingAddress.city} onChange={(event) => updateAddress("city", event.target.value)} />
                <Input placeholder="State" value={shippingAddress.state} onChange={(event) => updateAddress("state", event.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Postal code" value={shippingAddress.postalCode} onChange={(event) => updateAddress("postalCode", event.target.value)} />
                <CountrySelect
                  value={shippingAddress.country}
                  onChange={(country) => updateAddress("country", country)}
                  placeholder="Select country"
                />
              </div>
              <Input placeholder="Phone" value={shippingAddress.phone} onChange={(event) => updateAddress("phone", event.target.value)} />
            </SideCard>
          ) : null}

          <SideCard title="Tags" actionIcon={<Edit3 className="h-4 w-4" />}>
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="vip, wholesale"
            />
          </SideCard>
        </div>
      </div>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-4 py-4">
            <DialogTitle className="text-base">Select products</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 border-b p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_190px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder="Search products"
                  className="pl-9"
                />
              </div>
              <Select value="all" disabled>
                <SelectTrigger className="w-full">
                  <SelectValue>Search by All</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Search by All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" size="sm" disabled>
              Add filter
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_120px_120px] border-b px-4 py-2 text-xs text-muted-foreground">
            <span>Product</span>
            <span className="text-right">Available</span>
            <span className="text-right">Price</span>
          </div>
          <div className="h-[390px] overflow-auto">
            {isLoadingProducts ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading products
              </div>
            ) : productOptions.length > 0 ? (
              productOptions.map((option) => {
                const checked = selectedProductKeys.includes(option.key);
                return (
                  <div
                    key={option.key}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setSelectedProductKeys((current) =>
                        checked
                          ? current.filter((key) => key !== option.key)
                          : [...current, option.key],
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedProductKeys((current) =>
                        checked
                          ? current.filter((key) => key !== option.key)
                          : [...current, option.key],
                      );
                    }}
                    className={cn(
                      "grid w-full cursor-pointer grid-cols-[1fr_120px_120px] items-center border-b px-4 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent",
                      checked && "bg-accent",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Checkbox checked={checked} className="pointer-events-none" />
                      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted">
                        <AppImage
                          src={option.image}
                          alt={option.productName}
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {option.productName}
                        </span>
                        {option.variantName ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.variantName}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="text-right text-sm">{option.stock}</span>
                    <span className="text-right text-sm">
                      {formatPrice(option.price)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No products found
              </div>
            )}
          </div>
          <DialogFooter className="border-t p-4">
            <div className="mr-auto rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {selectedProductKeys.length}/500 variants selected
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setProductDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddSelectedProducts}
              disabled={selectedProductKeys.length === 0}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createCustomerDialogOpen}
        onOpenChange={(open) => {
          if (isCreatingCustomer) return;
          setCreateCustomerDialogOpen(open);
          if (!open) {
            setCreateCustomerForm(emptyCreateCustomerForm(defaultCountry));
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">New customer</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-customer-first-name">First name</Label>
                  <Input
                    id="new-customer-first-name"
                    value={createCustomerForm.firstName}
                    onChange={(event) =>
                      setCreateCustomerField("firstName", event.target.value)
                    }
                    placeholder="First name"
                    disabled={isCreatingCustomer}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-customer-last-name">Last name</Label>
                  <Input
                    id="new-customer-last-name"
                    value={createCustomerForm.lastName}
                    onChange={(event) =>
                      setCreateCustomerField("lastName", event.target.value)
                    }
                    placeholder="Last name"
                    disabled={isCreatingCustomer}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-customer-email">Email</Label>
                <Input
                  id="new-customer-email"
                  type="email"
                  value={createCustomerForm.email}
                  onChange={(event) =>
                    setCreateCustomerField("email", event.target.value)
                  }
                  placeholder="customer@example.com"
                  disabled={isCreatingCustomer}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-customer-phone">Phone number</Label>
                <Input
                  id="new-customer-phone"
                  value={createCustomerForm.phone}
                  onChange={(event) =>
                    setCreateCustomerField("phone", event.target.value)
                  }
                  placeholder="+880..."
                  disabled={isCreatingCustomer}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-customer-shipping-street">Shipping street</Label>
                <Input
                  id="new-customer-shipping-street"
                  value={createCustomerForm.shippingStreet}
                  onChange={(event) =>
                    setCreateCustomerField("shippingStreet", event.target.value)
                  }
                  placeholder="House, road, area"
                  disabled={isCreatingCustomer}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-customer-shipping-apartment">Apartment, suite, etc.</Label>
                <Input
                  id="new-customer-shipping-apartment"
                  value={createCustomerForm.shippingApartment}
                  onChange={(event) =>
                    setCreateCustomerField("shippingApartment", event.target.value)
                  }
                  placeholder="Optional"
                  disabled={isCreatingCustomer}
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-customer-shipping-city">Shipping city</Label>
                  <Input
                    id="new-customer-shipping-city"
                    value={createCustomerForm.shippingCity}
                    onChange={(event) =>
                      setCreateCustomerField("shippingCity", event.target.value)
                    }
                    placeholder="City"
                    disabled={isCreatingCustomer}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-customer-shipping-state">Shipping state</Label>
                  <Input
                    id="new-customer-shipping-state"
                    value={createCustomerForm.shippingState}
                    onChange={(event) =>
                      setCreateCustomerField("shippingState", event.target.value)
                    }
                    placeholder="State"
                    disabled={isCreatingCustomer}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-customer-shipping-postal">Postal code</Label>
                  <Input
                    id="new-customer-shipping-postal"
                    value={createCustomerForm.shippingPostalCode}
                    onChange={(event) =>
                      setCreateCustomerField("shippingPostalCode", event.target.value)
                    }
                    placeholder="Postal code"
                    disabled={isCreatingCustomer}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-customer-shipping-country">Country</Label>
                  <CountrySelect
                    id="new-customer-shipping-country"
                    value={createCustomerForm.shippingCountry}
                    onChange={(country) =>
                      setCreateCustomerField("shippingCountry", country)
                    }
                    placeholder="Select country"
                    searchPlaceholder="Search countries..."
                    disabled={isCreatingCustomer}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-customer-shipping-phone">Shipping phone</Label>
                <Input
                  id="new-customer-shipping-phone"
                  value={createCustomerForm.shippingPhone}
                  onChange={(event) =>
                    setCreateCustomerField("shippingPhone", event.target.value)
                  }
                  placeholder="+880..."
                  disabled={isCreatingCustomer}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-customer-tags">Tags</Label>
                <Input
                  id="new-customer-tags"
                  value={createCustomerForm.tagsInput}
                  onChange={(event) =>
                    setCreateCustomerField("tagsInput", event.target.value)
                  }
                  placeholder="vip, wholesale"
                  disabled={isCreatingCustomer}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-customer-notes">Notes</Label>
                <Textarea
                  id="new-customer-notes"
                  value={createCustomerForm.notes}
                  onChange={(event) =>
                    setCreateCustomerField("notes", event.target.value)
                  }
                  placeholder="Private internal notes"
                  className="min-h-28"
                  disabled={isCreatingCustomer}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateCustomerDialogOpen(false)}
              disabled={isCreatingCustomer}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreateCustomer()}
              disabled={isCreatingCustomer}
            >
              {isCreatingCustomer ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function SideCard({
  title,
  actionIcon,
  children,
}: {
  title: string;
  actionIcon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {actionIcon ? (
          <CardAction>
            <Button type="button" variant="ghost" size="icon-sm">
              {actionIcon}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function PaymentRow({
  label,
  detail,
  value,
  strong,
}: {
  label: string;
  detail?: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_120px] items-center gap-3 px-4 py-2 text-sm">
      <span className={strong ? "font-semibold" : undefined}>{label}</span>
      <span className="text-muted-foreground">{detail || "-"}</span>
      <span className={cn("text-right", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

function PaymentInputRow({
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_120px] items-center gap-3 px-4 py-2 text-sm">
      <span className="text-primary">{label}</span>
      <span className="text-muted-foreground">-</span>
      <div className="flex items-center gap-1">
        {prefix ? <span className="text-xs text-muted-foreground">{prefix}</span> : null}
        <Input
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 text-right"
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}
