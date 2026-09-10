"use client";

import { BadgeCheck } from "lucide-react";
import { CountrySelect } from "@/components/common/country-multi-select";
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
import { Switch } from "@/components/ui/switch";
import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import type { VendorFormValues, VendorTabProps } from "../vendor-detail-types";

const VENDOR_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
const VENDOR_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export function ProfileTab({ form, setField, readOnly }: VendorTabProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Store slug</Label>
            <Input
              id="slug"
              value={form.slug}
              onChange={(e) => setField("slug", e.target.value)}
              placeholder="auto-from-store-name"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={4}
              disabled={readOnly}
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
                disabled={readOnly}
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
                  const banner = items.find((item) => item.type === "image");
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
                disabled={readOnly}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Store Address</CardTitle>
          <CardDescription>
            Physical or registered address of the store
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vendor-address-street">Street</Label>
            <Input
              id="vendor-address-street"
              value={form.addressStreet}
              onChange={(e) => setField("addressStreet", e.target.value)}
              placeholder="House, road, area"
              disabled={readOnly}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-address-city">City</Label>
              <Input
                id="vendor-address-city"
                value={form.addressCity}
                onChange={(e) => setField("addressCity", e.target.value)}
                placeholder="City"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-address-state">State</Label>
              <Input
                id="vendor-address-state"
                value={form.addressState}
                onChange={(e) => setField("addressState", e.target.value)}
                placeholder="State"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-address-postal">Postal code</Label>
              <Input
                id="vendor-address-postal"
                value={form.addressPostalCode}
                onChange={(e) => setField("addressPostalCode", e.target.value)}
                placeholder="Postal code"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-address-country">Country</Label>
              <CountrySelect
                id="vendor-address-country"
                value={form.addressCountry}
                onChange={(country) => setField("addressCountry", country)}
                placeholder="Select country"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor-address-phone">Phone</Label>
            <Input
              id="vendor-address-phone"
              value={form.addressPhone}
              onChange={(e) => setField("addressPhone", e.target.value)}
              placeholder="e.g. +1 555 0123"
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Owner Account</CardTitle>
          <CardDescription>User account linked to this vendor</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ownerName">Owner name *</Label>
            <Input
              id="ownerName"
              value={form.ownerName}
              onChange={(e) => setField("ownerName", e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerEmail">Owner email *</Label>
            <Input
              id="ownerEmail"
              type="email"
              value={form.ownerEmail}
              onChange={(e) => setField("ownerEmail", e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerPhone">Owner phone</Label>
            <Input
              id="ownerPhone"
              value={form.ownerPhone}
              onChange={(e) => setField("ownerPhone", e.target.value)}
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Approval and account state</CardDescription>
        </CardHeader>
        {/* Paired rows rather than one column of narrow controls: the two
            statuses are read together (a suspended store with an active owner
            is a real, checkable combination), as are the two money settings. */}
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-status">Vendor status</Label>
              <Select
                value={form.status}
                disabled={readOnly}
                onValueChange={(value) => setField("status", value)}
              >
                {/* w-full: the trigger is w-fit by default, so each control
                    used to size itself to its own longest option and the
                    column read as a ragged edge. */}
                <SelectTrigger id="vendor-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={VENDOR_STATUS.PENDING}>Pending</SelectItem>
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
              <Label htmlFor="owner-status">Owner account status</Label>
              <Select
                value={form.userStatus}
                disabled={readOnly}
                onValueChange={(value) =>
                  setField("userStatus", value as VendorFormValues["userStatus"])
                }
              >
                <SelectTrigger id="owner-status" className="w-full">
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
          </div>

          {form.status === VENDOR_STATUS.REJECTED ? (
            <div className="space-y-2">
              <Label htmlFor="rejection-reason">Rejection reason</Label>
              <Textarea
                id="rejection-reason"
                value={form.rejectionReason}
                onChange={(e) => setField("rejectionReason", e.target.value)}
                placeholder="What the applicant needs to fix before applying again"
                maxLength={1000}
                rows={3}
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                Shown to the applicant on the become-a-vendor page, in the
                rejection email and in their notification. They can update
                their details and apply again.
              </p>
            </div>
          ) : null}

          {/* The storefront badge, and the only thing that grants it. Kept a
              separate switch rather than a side effect of "Approved": approval
              says a seller may trade here, verification says the platform has
              checked who they are — and buyers read the badge as the second.
              Boxed because it is the one control here that changes what a
              shopper sees. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/40 p-4">
            <div className="min-w-0 space-y-1">
              <Label
                htmlFor="vendor-verified"
                className="flex items-center gap-1.5 font-medium"
              >
                <BadgeCheck className="h-4 w-4 text-emerald-600" />
                Verified vendor
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Shows the green “Verified vendor” badge on this store&apos;s
                public page. Award it once you have checked the seller&apos;s
                documents and identity — it is never granted automatically.
              </p>
            </div>
            <Switch
              id="vendor-verified"
              checked={form.verified}
              onCheckedChange={(value) => setField("verified", value)}
              disabled={readOnly}
              className="mt-0.5 shrink-0"
            />
          </div>

          {/* Commission and COD sit on one row because they answer the same
              question — what this vendor owes the store, and who is holding the
              cash while it is owed. COD is deliberately administered here and
              absent from the vendor's own settings: a vendor who could set it
              to "the vendor" would be granting themselves the right to mark
              their own COD orders paid. */}
          {/* items-end: "Cash on delivery collected by" wraps to two lines in
              this half-width card, and without it the two fields sat at
              different heights. */}
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="commission">Commission %</Label>
              <NumberInput
                id="commission"
                min={0}
                max={100}
                value={form.commission}
                whenEmpty={0}
                onValueChange={(next) => setField("commission", next ?? 0)}
                disabled={readOnly}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="codCollectedBy">
                Cash on delivery collected by
              </Label>
              <Select
                value={form.codCollectedBy}
                onValueChange={(value) => setField("codCollectedBy", value)}
                disabled={readOnly}
              >
                <SelectTrigger id="codCollectedBy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Store default</SelectItem>
                  <SelectItem value="vendor">
                    The vendor (their own fleet)
                  </SelectItem>
                  <SelectItem value="platform">
                    The store (our courier)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Under the pair, not under the select: at half width this ran to
              five cramped lines beside an empty column. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            The vendor collecting means they hold the cash and owe you
            commission; the store collecting means you hold it and owe them
            their earnings. Existing orders keep the answer they were placed
            under.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
