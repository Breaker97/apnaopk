"use client";

import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import {
  Bell,
  Mail,
  MessageSquareText,
  MonitorSmartphone,
} from "lucide-react";
import { WarningBanner } from "@/components/ui/warning-banner";
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
  icon: typeof Bell;
}> = [
  { key: "inApp", icon: Bell },
  { key: "email", icon: Mail },
  { key: "browserPush", icon: MonitorSmartphone },
  { key: "sms", icon: MessageSquareText },
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
  const t = useTranslations("admin.settings.notifications");
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
          <span>{t("event")}</span>
          {channels.map((channel) => {
            const Icon = channel.icon;
            return (
              <span
                key={channel.key}
                className="inline-flex items-center justify-center gap-1"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(`channels.${channel.key}`)}
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
                      {t(`channels.${channel.key}`)}
                    </span>
                    <Switch
                      aria-label={`${row.title} ${t(`channels.${channel.key}`)}`}
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
  const t = useTranslations("admin.settings");
  const notifications = settings.notifications;
  const smsReady = isSmsConfigured(settings);
  const smsSelected = hasAnySmsNotification(notifications);

  const adminRows: NotificationRow[] = [
    {
      title: t("notifications.events.admin.newOrders.title"),
      description: t("notifications.events.admin.newOrders.description"),
      path: "notifications.admin.newOrders",
      settings: notifications.admin.newOrders,
    },
    {
      title: t("notifications.events.admin.newCustomers.title"),
      description: t("notifications.events.admin.newCustomers.description"),
      path: "notifications.admin.newCustomers",
      settings: notifications.admin.newCustomers,
    },
    {
      title: t("notifications.events.admin.newVendors.title"),
      description: t("notifications.events.admin.newVendors.description"),
      path: "notifications.admin.newVendors",
      settings: notifications.admin.newVendors,
    },
    {
      title: t("notifications.events.admin.returns.title"),
      description: t("notifications.events.admin.returns.description"),
      path: "notifications.admin.returns",
      settings: notifications.admin.returns,
    },
    {
      title: t("notifications.events.admin.payments.title"),
      description: t("notifications.events.admin.payments.description"),
      path: "notifications.admin.payments",
      settings: notifications.admin.payments,
    },
    {
      title: t("notifications.events.admin.preorderAccessRequests.title"),
      description: t("notifications.events.admin.preorderAccessRequests.description"),
      path: "notifications.admin.preorderAccessRequests",
      settings: notifications.admin.preorderAccessRequests,
    },
  ];

  const vendorRows: NotificationRow[] = [
    {
      title: t("notifications.events.vendor.applicationStatus.title"),
      description: t("notifications.events.vendor.applicationStatus.description"),
      path: "notifications.vendor.applicationStatus",
      settings: notifications.vendor.applicationStatus,
    },
    {
      title: t("notifications.events.vendor.newOrders.title"),
      description: t("notifications.events.vendor.newOrders.description"),
      path: "notifications.vendor.newOrders",
      settings: notifications.vendor.newOrders,
    },
    {
      title: t("notifications.events.vendor.returns.title"),
      description: t("notifications.events.vendor.returns.description"),
      path: "notifications.vendor.returns",
      settings: notifications.vendor.returns,
    },
    {
      title: t("notifications.events.vendor.preorderAccess.title"),
      description: t("notifications.events.vendor.preorderAccess.description"),
      path: "notifications.vendor.preorderAccess",
      settings: notifications.vendor.preorderAccess,
    },
  ];

  const staffRows: NotificationRow[] = [
    {
      title: t("notifications.events.staff.newOrders.title"),
      description: t("notifications.events.staff.newOrders.description"),
      path: "notifications.staff.newOrders",
      settings: notifications.staff.newOrders,
    },
    {
      title: t("notifications.events.staff.newCustomers.title"),
      description: t("notifications.events.staff.newCustomers.description"),
      path: "notifications.staff.newCustomers",
      settings: notifications.staff.newCustomers,
    },
    {
      title: t("notifications.events.staff.returns.title"),
      description: t("notifications.events.staff.returns.description"),
      path: "notifications.staff.returns",
      settings: notifications.staff.returns,
    },
    {
      title: t("notifications.events.staff.payments.title"),
      description: t("notifications.events.staff.payments.description"),
      path: "notifications.staff.payments",
      settings: notifications.staff.payments,
    },
    {
      title: t("notifications.events.staff.lowStock.title"),
      description: t("notifications.events.staff.lowStock.description"),
      path: "notifications.staff.lowStock",
      settings: notifications.staff.lowStock,
    },
  ];

  const customerRows: NotificationRow[] = [
    {
      title: t("notifications.events.customer.orderUpdates.title"),
      description: t("notifications.events.customer.orderUpdates.description"),
      path: "notifications.customer.orderUpdates",
      settings: notifications.customer.orderUpdates,
    },
    {
      title: t("notifications.events.customer.returnUpdates.title"),
      description: t("notifications.events.customer.returnUpdates.description"),
      path: "notifications.customer.returnUpdates",
      settings: notifications.customer.returnUpdates,
    },
  ];

  const smsSettingsLink = (
    <Link
      href="/admin/settings/sms"
      className="font-medium underline-offset-4 hover:underline"
    >
      {t("notifications.smsSettingsLink")}
    </Link>
  );

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("notifications.title")}
        description={t("notifications.description")}
      />

      <Card>
        <CardContent className="space-y-6">
          {!smsReady &&
            (smsSelected ? (
              <WarningBanner>
                {t("notifications.smsOffWarning")} {smsSettingsLink}
              </WarningBanner>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {t("notifications.smsSetupHint")} {smsSettingsLink}
                </p>
              </div>
            ))}
          <NotificationGroup
            title={t("notifications.groups.admin.title")}
            description={t("notifications.groups.admin.description")}
            rows={adminRows}
            smsReady={smsReady}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title={t("notifications.groups.vendor.title")}
            description={t("notifications.groups.vendor.description")}
            rows={vendorRows}
            smsReady={smsReady}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title={t("notifications.groups.staff.title")}
            description={t("notifications.groups.staff.description")}
            rows={staffRows}
            smsReady={smsReady}
            updateNestedField={updateNestedField}
          />
          <NotificationGroup
            title={t("notifications.groups.customer.title")}
            description={t("notifications.groups.customer.description")}
            rows={customerRows}
            smsReady={smsReady}
            updateNestedField={updateNestedField}
          />

          <StickySaveFooter
            label={t("saveChanges")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
