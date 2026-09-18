"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import {
  AlertTriangle,
  Bell,
  Mail,
  MessageSquareText,
  MonitorSmartphone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  NotificationChannelSettings,
  Settings,
} from "@/components/admin/settings/types";
import { isSmsConfigured } from "@/components/admin/settings/settings-sections";
import { hasAnySmsNotification } from "@/lib/notifications/notification-settings";
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
  { key: "sms", label: "SMS", icon: MessageSquareText },
];

/**
 * Four switch columns do not fit beside an event name on a phone, so below
 * `sm` each row stacks: the event, then its switches with their own labels.
 */
const ROW_GRID =
  "sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(4,64px)] sm:items-center sm:gap-3";

function NotificationGroup(props: {
  title: string;
  description: string;
  rows: NotificationRow[];
  smsReady: boolean;
  updateNestedField: (path: string, value: unknown) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div
          className={cn(
            "hidden border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground",
            ROW_GRID,
          )}
        >
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
            className={cn(
              "space-y-3 px-4 py-3 text-sm data-[border=true]:border-t sm:space-y-0",
              ROW_GRID,
            )}
            data-border={index > 0}
          >
            <div className="min-w-0">
              <p className="font-medium">{row.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.description}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:contents">
              {channels.map((channel) => {
                const Icon = channel.icon;
                const disabled = channel.key === "sms" && !props.smsReady;
                return (
                  <label
                    key={channel.key}
                    className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground sm:block sm:text-center"
                  >
                    <span className="inline-flex items-center gap-1 sm:hidden">
                      <Icon className="h-3 w-3" />
                      {channel.label}
                    </span>
                    <Switch
                      aria-label={`${row.title} ${channel.label}`}
                      checked={row.settings[channel.key]}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        props.updateNestedField(
                          `${row.path}.${channel.key}`,
                          checked,
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
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
  const locale = useLocale();
  const notifications = settings.notifications;
  const smsReady = isSmsConfigured(settings);
  const smsSelected = hasAnySmsNotification(notifications);

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
    {
      title: "Pre-order access requests",
      description: "Notify admins when a vendor asks to sell pre-orders.",
      path: "notifications.admin.preorderAccessRequests",
      settings: notifications.admin.preorderAccessRequests,
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
    {
      title: "Vendor pre-order access",
      description:
        "Notify vendors when their pre-order access is approved, declined or withdrawn.",
      path: "notifications.vendor.preorderAccess",
      settings: notifications.vendor.preorderAccess,
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
        description="Choose which events create dashboard notifications, emails, push alerts and text messages."
      />

      <Card>
        <CardContent className="space-y-6">
          {!smsReady && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-sm",
                smsSelected
                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100"
                  : "bg-muted/40 text-muted-foreground",
              )}
            >
              {smsSelected ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <p>
                {smsSelected
                  ? "Some events are set to send a text, but SMS is switched off or not fully set up, so none will go out. "
                  : "To send text messages, set up Twilio first. "}
                <Link
                  href={`/${locale}/admin/settings/sms`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  SMS settings
                </Link>
              </p>
            </div>
          )}
          <NotificationGroup
            title="Admin notifications"
            description="Events that should alert the store admin team."
            rows={adminRows}
            smsReady={smsReady}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title="Vendor notifications"
            description="Events sent to vendor accounts."
            rows={vendorRows}
            smsReady={smsReady}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title="Staff notifications"
            description="Events sent to active staff based on their module permissions."
            rows={staffRows}
            smsReady={smsReady}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title="Customer notifications"
            description="Events sent to customer accounts."
            rows={customerRows}
            smsReady={smsReady}
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
