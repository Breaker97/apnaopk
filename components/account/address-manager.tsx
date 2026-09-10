"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CountrySelect } from "@/components/common/country-multi-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FLOATING_INPUT_CLASS,
  FLOATING_LABEL_CLASS,
} from "@/lib/constants";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { toast } from "@/components/ui/toast-notification";

type AddressLabel = "home" | "work" | "other";

interface Address {
  _id?: string;
  firstName?: string;
  lastName?: string;
  street: string;
  city: string;
  state?: string;
  apartment?: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
  label?: AddressLabel;
}

/**
 * How a mutation names the address it targets.
 *
 * An id when the record has one, and the array position otherwise — addresses
 * saved before the sub-schema carried an `_id` still only have a position. The
 * server prefers whichever is more specific; see `lib/saved-addresses.ts`.
 */
function addressSelector(
  address: Address,
  index: number,
): { id: string } | { index: number } {
  return address._id ? { id: address._id } : { index };
}

const emptyAddress: Omit<Address, "_id"> = {
  firstName: "",
  lastName: "",
  street: "",
  city: "",
  state: "",
  apartment: "",
  postalCode: "",
  country: "",
  phone: "",
  isDefault: false,
  label: "home",
};

export function AddressManager() {
  const t = useTranslations();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [editingSelector, setEditingSelector] = useState<
    { id: string } | { index: number } | null
  >(null);
  const [addressToDelete, setAddressToDelete] = useState<
    { id: string } | { index: number } | null
  >(null);
  const [formData, setFormData] = useState<Omit<Address, "_id">>(emptyAddress);

  const fetchAddresses = useCallback(
    () =>
      apiClient
        .get<{ addresses?: Address[] }>("/api/user/addresses")
        .then((data) => setAddresses(data?.addresses || []))
        .catch((error) => {
          console.error("Failed to fetch addresses:", error);
          setAddresses([]);
        })
        .finally(() => setIsLoading(false)),
    [],
  );

  useEffect(() => {
    void fetchAddresses();
  }, [fetchAddresses]);

  const handleOpenAddDialog = () => {
    setEditingAddress(null);
    setFormData(emptyAddress);
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (address: Address, index: number) => {
    setEditingAddress(address);
    // The id is what the API is asked to edit; the position is kept only as a
    // fallback for addresses saved before they had one. This used to stuff the
    // index into `_id`, which now collides with the real ids the server sends.
    setEditingSelector(addressSelector(address, index));
    setFormData(address);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const method = editingAddress ? "PUT" : "POST";
      const body = editingAddress
        ? { ...editingSelector, address: formData }
        : { address: formData };

      if (method === "PUT") {
        await apiClient.put("/api/user/addresses", body);
      } else {
        await apiClient.post("/api/user/addresses", body);
      }
      await fetchAddresses();
      setIsDialogOpen(false);
      setFormData(emptyAddress);
      window.dispatchEvent(new Event("account:stats-changed"));
    } catch (error) {
      console.error("Failed to save address:", error);
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to save address",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (addressToDelete === null) return;
    setIsSaving(true);
    try {
      await apiClient.request("DELETE", "/api/user/addresses", addressToDelete);
      await fetchAddresses();
      setIsDeleteDialogOpen(false);
      setAddressToDelete(null);
      window.dispatchEvent(new Event("account:stats-changed"));
    } catch (error) {
      console.error("Failed to delete address:", error);
      // Without this the dialog just closes and the card stays put, which reads
      // as "delete did nothing" — indistinguishable from a UI bug.
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : t("addresses.deleteFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDefault = async (address: Address, index: number) => {
    try {
      await apiClient.put(
        "/api/user/addresses/default",
        addressSelector(address, index),
      );
      await fetchAddresses();
    } catch (error) {
      console.error("Failed to set default address:", error);
      // A silent failure here is the worst of the three: the shopper believes
      // their default changed, and checkout goes on auto-filling the old one.
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : t("addresses.setDefaultFailed"),
      );
    }
  };

  const openDeleteDialog = (address: Address, index: number) => {
    setAddressToDelete(addressSelector(address, index));
    setIsDeleteDialogOpen(true);
  };

  // Format the full name from firstName and lastName
  const getFullName = (address: Address) => {
    const parts = [address.firstName, address.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : null;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Address Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Existing Address Cards */}
        {addresses.map((address, index) => {
          // Get display label
          const labelType = (address.label || "home") as AddressLabel;
          const labelDisplay =
            labelType === "work"
              ? t("addresses.labelWork")
              : labelType === "other"
                ? t("addresses.labelOther")
                : t("addresses.labelHome");

          return (
            <div
              key={index}
              className="bg-card rounded-xl border border-border p-5 flex flex-col min-h-[220px] shadow-sm"
            >
              {/* Header with label and default badge */}
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-semibold text-foreground">
                  {labelDisplay}
                </h3>
                {address.isDefault && (
                  <Badge
                    variant="secondary"
                    className="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border-0 text-xs font-medium px-2 py-0.5"
                  >
                    {t("addresses.default")}
                  </Badge>
                )}
              </div>

              {/* Address Details */}
              <div className="flex-1 space-y-1 text-sm text-muted-foreground">
                {/* Full Name */}
                {getFullName(address) && (
                  <p className="text-foreground">{getFullName(address)}</p>
                )}
                {/* Street Address */}
                <p>
                  {address.street}
                  {address.apartment && `, ${address.apartment}`}
                </p>
                {/* City, State, Zip, Country */}
                <p>
                  {address.city}
                  {address.state && `, ${address.state}`} {address.postalCode}
                  {address.country && `, ${address.country}`}
                </p>
                {/* Phone */}
                {address.phone && <p className="pt-2">{address.phone}</p>}
              </div>

              {/* Action Links */}
              <div className="flex items-center gap-3 pt-4 mt-auto border-t border-border/50">
                <button
                  onClick={() => handleOpenEditDialog(address, index)}
                  className="text-sm font-medium text-foreground underline hover:no-underline"
                >
                  {t("common.edit")}
                </button>
                <span className="text-muted-foreground/50">|</span>
                <button
                  onClick={() => openDeleteDialog(address, index)}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  {t("common.remove")}
                </button>
                <span className="text-muted-foreground/50">|</span>
                {address.isDefault ? (
                  <span className="text-sm text-muted-foreground/50">
                    {t("addresses.setDefault")}
                  </span>
                ) : (
                  <button
                    onClick={() => handleSetDefault(address, index)}
                    className="text-sm font-medium text-muted-foreground underline hover:text-foreground hover:no-underline"
                  >
                    {t("addresses.setDefault")}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Address Card */}
        <button
          onClick={handleOpenAddDialog}
          className="bg-transparent rounded-xl border-2 border-dashed border-muted-foreground/30 p-5 flex flex-col items-center justify-center min-h-[220px] hover:border-muted-foreground/50 hover:bg-muted/20 transition-colors cursor-pointer"
        >
          <Plus className="h-6 w-6 text-muted-foreground mb-2" />
          <span className="text-sm text-muted-foreground">
            {t("addresses.addAddress")}
          </span>
        </button>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingAddress
                ? t("addresses.editAddress")
                : t("addresses.addAddress")}
            </DialogTitle>
            <DialogDescription>
              {t("addresses.formDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            {/* Address type */}
            <div className="relative w-full">
              <Select
                value={(formData.label || "home") as AddressLabel}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    label: value as AddressLabel,
                  })
                }
              >
                <SelectTrigger className="w-full data-[size=default]:h-14 rounded-lg pt-6 pb-2 items-end [&>span]:text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="work">Work</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <span className="pointer-events-none absolute left-3 top-2 text-xs text-muted-foreground z-10">
                {t("addresses.addressType")}
              </span>
            </div>

            {/* Country */}
            <div className="relative w-full">
              <CountrySelect
                value={formData.country}
                onChange={(value) =>
                  setFormData({ ...formData, country: value })
                }
                placeholder=" "
                searchPlaceholder={t("checkout.searchCountry")}
                triggerClassName="h-14 rounded-lg pt-6 pb-2 items-end [&>span]:text-base"
              />
              <span className="pointer-events-none absolute left-3 top-2 text-xs text-muted-foreground z-10">
                {t("checkout.country")}
              </span>
            </div>

            {/* First name + Last name */}
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Input
                  id="firstName"
                  value={formData.firstName || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
                  }
                  placeholder=" "
                  className={FLOATING_INPUT_CLASS}
                />
                <label htmlFor="firstName" className={FLOATING_LABEL_CLASS}>
                  {t("checkout.firstName")}
                </label>
              </div>
              <div className="relative">
                <Input
                  id="lastName"
                  value={formData.lastName || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                  placeholder=" "
                  className={FLOATING_INPUT_CLASS}
                />
                <label htmlFor="lastName" className={FLOATING_LABEL_CLASS}>
                  {t("checkout.lastName")}
                </label>
              </div>
            </div>

            {/* Street */}
            <div className="relative">
              <Input
                id="street"
                value={formData.street}
                onChange={(e) =>
                  setFormData({ ...formData, street: e.target.value })
                }
                placeholder=" "
                className={FLOATING_INPUT_CLASS}
              />
              <label htmlFor="street" className={FLOATING_LABEL_CLASS}>
                {t("checkout.address")}
              </label>
            </div>

            {/* Apartment */}
            <div className="relative">
              <Input
                id="apartment"
                value={formData.apartment || ""}
                onChange={(e) =>
                  setFormData({ ...formData, apartment: e.target.value })
                }
                placeholder=" "
                className={FLOATING_INPUT_CLASS}
              />
              <label htmlFor="apartment" className={FLOATING_LABEL_CLASS}>
                {t("checkout.apartment")}
              </label>
            </div>

            {/* City + Postal code */}
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) =>
                    setFormData({ ...formData, city: e.target.value })
                  }
                  placeholder=" "
                  className={FLOATING_INPUT_CLASS}
                />
                <label htmlFor="city" className={FLOATING_LABEL_CLASS}>
                  {t("checkout.city")}
                </label>
              </div>
              <div className="relative">
                <Input
                  id="postalCode"
                  value={formData.postalCode}
                  onChange={(e) =>
                    setFormData({ ...formData, postalCode: e.target.value })
                  }
                  placeholder=" "
                  className={FLOATING_INPUT_CLASS}
                />
                <label htmlFor="postalCode" className={FLOATING_LABEL_CLASS}>
                  {t("checkout.postalCode")}
                </label>
              </div>
            </div>

            {/* State */}
            <div className="relative">
              <Input
                id="state"
                value={formData.state || ""}
                onChange={(e) =>
                  setFormData({ ...formData, state: e.target.value })
                }
                placeholder=" "
                className={FLOATING_INPUT_CLASS}
              />
              <label htmlFor="state" className={FLOATING_LABEL_CLASS}>
                {t("checkout.state")}
              </label>
            </div>

            {/* Phone */}
            <div className="relative">
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                placeholder=" "
                className={FLOATING_INPUT_CLASS}
              />
              <label htmlFor="phone" className={FLOATING_LABEL_CLASS}>
                {t("checkout.phone")}
              </label>
            </div>

            {/* Default address checkbox */}
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="isDefault"
                checked={Boolean(formData.isDefault)}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isDefault: checked === true })
                }
              />
              <Label
                htmlFor="isDefault"
                className="text-sm font-normal cursor-pointer"
              >
                {t("addresses.defaultCheckbox")}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("addresses.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("addresses.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
