"use client";

import { Bell, Mail, MonitorSmartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type {
  NotificationChannelSettings,
  Settings,
} from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

type ChannelKey = keyof NotificationChannelSettings;

type NotificationRow = {
  title: string;
  description: string;
  path: string;
  settings: NotificationChannelSettings;
};

const channels: Array<{
  key: ChannelKey;
  label: string;
  icon: typeof Bell;
}> = [
  { key: "inApp", label: "In-app", icon: Bell },
  { key: "email", label: "Email", icon: Mail },
  { key: "browserPush", label: "Push", icon: MonitorSmartphone },
];

function NotificationGroup(props: {
  title: string;
  description: string;
  rows: NotificationRow[];
  updateNestedField: (path: string, value: unknown) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Event</span>
          {channels.map((channel) => {
            const Icon = channel.icon;
            return (
              <span
                key={channel.key}
                className="inline-flex items-center justify-center gap-1"
              >
                <Icon className="h-3.5 w-3.5" />
                {channel.label}
              </span>
            );
          })}
        </div>

        {props.rows.map((row, index) => (
          <div
            key={row.path}
            className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-3 px-4 py-3 text-sm data-[border=true]:border-t"
            data-border={index > 0}
          >
            <div className="min-w-0">
              <p className="font-medium">{row.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.description}
              </p>
            </div>
            {channels.map((channel) => (
              <div key={channel.key} className="flex justify-center">
                <Switch
                  aria-label={`${row.title} ${channel.label}`}
                  checked={row.settings[channel.key]}
                  onCheckedChange={(checked) =>
                    props.updateNestedField(
                      `${row.path}.${channel.key}`,
                      checked,
                    )
                  }
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function NotificationsSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;
  const notifications = settings.notifications;

  const adminRows: NotificationRow[] = [
    {
      title: "New orders",
      description: "Notify admins when an order is placed.",
      path: "notifications.admin.newOrders",
      settings: notifications.admin.newOrders,
    },
    {
      title: "New customers",
      description: "Notify admins when a customer profile is created.",
      path: "notifications.admin.newCustomers",
      settings: notifications.admin.newCustomers,
    },
    {
      title: "New vendor applications",
      description: "Notify admins when a vendor application is pending.",
      path: "notifications.admin.newVendors",
      settings: notifications.admin.newVendors,
    },
    {
      title: "Return requests",
      description: "Notify admins when a return request needs review.",
      path: "notifications.admin.returns",
      settings: notifications.admin.returns,
    },
    {
      title: "Payments",
      description: "Notify admins when payment activity is recorded.",
      path: "notifications.admin.payments",
      settings: notifications.admin.payments,
    },
  ];

  const vendorRows: NotificationRow[] = [
    {
      title: "Vendor application status",
      description: "Notify vendors when their account is approved or rejected.",
      path: "notifications.vendor.applicationStatus",
      settings: notifications.vendor.applicationStatus,
    },
    {
      title: "Vendor new orders",
      description: "Notify vendors when they receive a new order.",
      path: "notifications.vendor.newOrders",
      settings: notifications.vendor.newOrders,
    },
    {
      title: "Vendor return requests",
      description: "Notify vendors when a return request belongs to them.",
      path: "notifications.vendor.returns",
      settings: notifications.vendor.returns,
    },
  ];

  const staffRows: NotificationRow[] = [
    {
      title: "Staff new orders",
      description: "Notify staff with order access when an order is placed.",
      path: "notifications.staff.newOrders",
      settings: notifications.staff.newOrders,
    },
    {
      title: "Staff new customers",
      description:
        "Notify staff with customer access when a customer profile is created.",
      path: "notifications.staff.newCustomers",
      settings: notifications.staff.newCustomers,
    },
    {
      title: "Staff return requests",
      description:
        "Notify staff with order access when return requests need review.",
      path: "notifications.staff.returns",
      settings: notifications.staff.returns,
    },
    {
      title: "Staff payments",
      description:
        "Notify POS and order staff when payment activity is recorded.",
      path: "notifications.staff.payments",
      settings: notifications.staff.payments,
    },
    {
      title: "Staff low stock",
      description:
        "Notify inventory staff when products need replenishment attention.",
      path: "notifications.staff.lowStock",
      settings: notifications.staff.lowStock,
    },
  ];

  const customerRows: NotificationRow[] = [
    {
      title: "Customer order updates",
      description: "Notify customers when order status changes.",
      path: "notifications.customer.orderUpdates",
      settings: notifications.customer.orderUpdates,
    },
    {
      title: "Customer return updates",
      description: "Notify customers when return status changes.",
      path: "notifications.customer.returnUpdates",
      settings: notifications.customer.returnUpdates,
    },
  ];

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title="Notification Settings"
        description="Choose which events create dashboard notifications, emails, and browser push alerts."
      />

      <Card>
        <CardContent className="space-y-6">
          <NotificationGroup
            title="Admin notifications"
            description="Events that should alert the store admin team."
            rows={adminRows}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title="Vendor notifications"
            description="Events sent to vendor accounts."
            rows={vendorRows}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title="Staff notifications"
            description="Events sent to active staff based on their module permissions."
            rows={staffRows}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title="Customer notifications"
            description="Events sent to customer accounts."
            rows={customerRows}
            updateNestedField={updateNestedField}
          />

          <StickySaveFooter
            label="Save Changes"
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
