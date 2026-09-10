"use client";

import { CountrySelect } from "@/components/common/country-multi-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { USER_ACCOUNT_STATUS } from "@/config/app.config";
import type {
  CustomerEmailNotifications,
  CustomerFormValues,
  CustomerTabProps,
} from "../customer-detail-types";

const EMAIL_NOTIFICATION_OPTIONS: {
  key: keyof CustomerEmailNotifications;
  label: string;
  description: string;
}[] = [
  {
    key: "orderUpdates",
    label: "Order updates",
    description: "Shipping, delivery, and status changes",
  },
  {
    key: "promotions",
    label: "Promotions",
    description: "Discounts, sales, and campaigns",
  },
  {
    key: "newsletter",
    label: "Newsletter",
    description: "Periodic store newsletter",
  },
  {
    key: "priceDrops",
    label: "Price drops",
    description: "Alerts when watched items get cheaper",
  },
  {
    key: "backInStock",
    label: "Back in stock",
    description: "Alerts when saved items are restocked",
  },
];

export function ProfileTab({ form, setField, readOnly }: CustomerTabProps) {
  const setNotification = (
    key: keyof CustomerEmailNotifications,
    value: boolean,
  ) => {
    setField("emailNotifications", { ...form.emailNotifications, [key]: value });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>
            Customer account identity and contact fields
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-name">Full name *</Label>
            <Input
              id="customer-name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="e.g. Jane Doe"
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-email">Email *</Label>
            <Input
              id="customer-email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="e.g. jane@example.com"
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-phone">Phone</Label>
            <Input
              id="customer-phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="e.g. +1 555 0123"
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <Label>Account status</Label>
            <Select
              value={form.status}
              disabled={readOnly}
              onValueChange={(value) =>
                setField("status", value as CustomerFormValues["status"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={USER_ACCOUNT_STATUS.ACTIVE}>Active</SelectItem>
                <SelectItem value={USER_ACCOUNT_STATUS.INACTIVE}>
                  Inactive
                </SelectItem>
                <SelectItem value={USER_ACCOUNT_STATUS.BANNED}>Banned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Segmentation</CardTitle>
          <CardDescription>
            Profile settings used by support and marketing teams
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-acquisition-source">
              Acquisition source
            </Label>
            <Input
              id="customer-acquisition-source"
              value={form.acquisitionSource}
              onChange={(e) => setField("acquisitionSource", e.target.value)}
              placeholder="e.g. instagram, organic, referral"
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-tags">Tags</Label>
            <Input
              id="customer-tags"
              value={form.tagsInput}
              onChange={(e) => setField("tagsInput", e.target.value)}
              placeholder="vip, repeat, b2b"
              disabled={readOnly}
            />
            <p className="text-xs text-muted-foreground">
              Separate tags with commas
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Communication Preferences</CardTitle>
          <CardDescription>
            Marketing consent and email notification settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5 pr-4">
              <Label className="text-sm">Marketing opt-in</Label>
              <p className="text-xs text-muted-foreground">
                Customer agreed to receive marketing communications
              </p>
            </div>
            <Switch
              checked={form.marketingOptIn}
              disabled={readOnly}
              onCheckedChange={(value) => setField("marketingOptIn", value)}
            />
          </div>

          <div className="space-y-3">
            {EMAIL_NOTIFICATION_OPTIONS.map((option) => (
              <div
                key={option.key}
                className="flex items-center justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <Label className="text-sm font-normal">{option.label}</Label>
                  <p className="text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
                <Switch
                  checked={form.emailNotifications[option.key]}
                  disabled={readOnly}
                  onCheckedChange={(value) =>
                    setNotification(option.key, value)
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipping Address</CardTitle>
          <CardDescription>
            Default shipping address for quick order creation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="customer-shipping-first-name">First name</Label>
              <Input
                id="customer-shipping-first-name"
                value={form.shippingFirstName}
                onChange={(e) => setField("shippingFirstName", e.target.value)}
                placeholder="e.g. Jane"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-shipping-last-name">Last name</Label>
              <Input
                id="customer-shipping-last-name"
                value={form.shippingLastName}
                onChange={(e) => setField("shippingLastName", e.target.value)}
                placeholder="e.g. Doe"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-shipping-street">Street</Label>
            <Input
              id="customer-shipping-street"
              value={form.shippingStreet}
              onChange={(e) => setField("shippingStreet", e.target.value)}
              placeholder="House, road, area"
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-shipping-apartment">
              Apartment, suite, etc.
            </Label>
            <Input
              id="customer-shipping-apartment"
              value={form.shippingApartment}
              onChange={(e) => setField("shippingApartment", e.target.value)}
              placeholder="Optional"
              disabled={readOnly}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="customer-shipping-city">City</Label>
              <Input
                id="customer-shipping-city"
                value={form.shippingCity}
                onChange={(e) => setField("shippingCity", e.target.value)}
                placeholder="City"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-shipping-state">State</Label>
              <Input
                id="customer-shipping-state"
                value={form.shippingState}
                onChange={(e) => setField("shippingState", e.target.value)}
                placeholder="State"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="customer-shipping-postal">Postal code</Label>
              <Input
                id="customer-shipping-postal"
                value={form.shippingPostalCode}
                onChange={(e) => setField("shippingPostalCode", e.target.value)}
                placeholder="Postal code"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-shipping-country">Country</Label>
              <CountrySelect
                id="customer-shipping-country"
                value={form.shippingCountry}
                onChange={(country) => setField("shippingCountry", country)}
                placeholder="Select country"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-shipping-phone">Phone</Label>
            <Input
              id="customer-shipping-phone"
              value={form.shippingPhone}
              onChange={(e) => setField("shippingPhone", e.target.value)}
              placeholder="e.g. +1 555 0123"
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
