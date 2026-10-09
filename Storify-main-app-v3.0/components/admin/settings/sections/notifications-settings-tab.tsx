"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import {
  Info,
  MessageSquareText,
  MoreVertical,
  RotateCcw,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from "@/components/admin/underline-tabs";
import { cn } from "@/lib/utils";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import {
  countChannelNotifications,
  countSmsNotifications,
} from "@/lib/notifications/notification-settings";
import type { Settings } from "@/components/admin/settings/types";
import {
  isEmailConfigured,
  isSmsConfigured,
} from "@/components/admin/settings/settings-sections";
import type { StaffNotificationAudience } from "@/components/admin/settings/use-staff-notification-audience";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { ChannelHeader } from "./notifications/channel-header";
import {
  NOTIFICATION_CHANNELS,
  audienceChanged,
  channelsOf,
  eventShows,
  guestsHearOf,
  recommendedNotificationSettings,
  visibleAudiences,
  type NotificationAudience,
  type NotificationChannel,
} from "./notifications/notification-audiences";

const linkClass = "text-primary font-medium hover:underline";
const warningLinkClass = "font-medium underline underline-offset-4";

/** Four tabs fit a phone only with less room around each. */
const TAB_CLASS = "gap-1.5 px-2.5 @md:px-4";

/** One row's copy: its name, and a line under it only where it says more. */
type EventCopy = { title: string; hint?: string; nobody?: string; guestsMiss?: string };

/**
 * Settings → Notifications: who hears about each event, and how.
 *
 * One tab per audience, each a single grid of ticks. A tab shows only the
 * events that can happen on this store and only the channels that can reach
 * its people; a channel that is not set up says so once, at the top, instead
 * of on every row.
 */
export function NotificationsSettingsTab(props: {
  settings: Settings;
  /** The saved copy: what reaches people today, and what an edit is measured against. */
  savedSettings: Settings;
  staffAudience: StaffNotificationAudience | null;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard: () => void;
}) {
  const { settings, savedSettings, staffAudience, updateNestedField } = props;
  const t = useTranslations("admin.settings.notifications");
  const tSettings = useTranslations("admin.settings");
  const tSaveBar = useTranslations("admin.settings.saveBar");
  const notifications = settings.notifications;

  const preorder = resolvePreorderPolicy(settings.preorder);
  const store = {
    multiVendor: Boolean(settings.multiVendorMode?.enabled),
    preorderApproval: preorder.enabled && preorder.requireVendorApproval,
  };
  const audiences = visibleAudiences(store);
  const [picked, setPicked] = useState<NotificationAudience>("admin");
  const tab = audiences.includes(picked) ? picked : audiences[0];

  // What reaches people is what is saved, so readiness reads the saved copy.
  const ready: Record<NotificationChannel, boolean> = {
    inApp: true,
    email: isEmailConfigured(savedSettings),
    browserPush: savedSettings._meta?.webPush?.configured !== false,
    sms: isSmsConfigured(savedSettings),
  };
  // A text column with Twilio missing would be a column of dead ticks, so it
  // shows once texts can go out, or while a saved tick still needs clearing.
  const showSms =
    ready.sms || countSmsNotifications(savedSettings.notifications) > 0;
  const channels = NOTIFICATION_CHANNELS.filter(
    (channel) => channel !== "sms" || showSms,
  );

  const smsTicked = countSmsNotifications(notifications);
  const emailTicked = countChannelNotifications(notifications, "email");
  const pushTicked = countChannelNotifications(notifications, "browserPush");

  const copy: Record<NotificationAudience, Record<string, EventCopy>> = {
    admin: {
      newOrders: { title: t("events.admin.newOrders.title") },
      newCustomers: { title: t("events.admin.newCustomers.title") },
      newVendors: { title: t("events.admin.newVendors.title") },
      returns: { title: t("events.admin.returns.title") },
      payments: { title: t("events.admin.payments.title") },
      preorderAccessRequests: {
        title: t("events.admin.preorderAccessRequests.title"),
      },
      lowStock: {
        title: t("events.admin.lowStock.title"),
        hint: t("events.admin.lowStock.hint"),
      },
    },
    staff: {
      newOrders: {
        title: t("events.staff.newOrders.title"),
        hint: t("events.staff.newOrders.hint"),
        nobody: t("events.staff.newOrders.nobody"),
      },
      newCustomers: {
        title: t("events.staff.newCustomers.title"),
        hint: t("events.staff.newCustomers.hint"),
        nobody: t("events.staff.newCustomers.nobody"),
      },
      returns: {
        title: t("events.staff.returns.title"),
        hint: t("events.staff.returns.hint"),
        nobody: t("events.staff.returns.nobody"),
      },
      payments: {
        title: t("events.staff.payments.title"),
        hint: t("events.staff.payments.hint"),
        nobody: t("events.staff.payments.nobody"),
      },
      lowStock: {
        title: t("events.staff.lowStock.title"),
        hint: t("events.staff.lowStock.hint"),
        nobody: t("events.staff.lowStock.nobody"),
      },
    },
    vendor: {
      applicationStatus: {
        title: t("events.vendor.applicationStatus.title"),
        hint: t("events.vendor.applicationStatus.hint"),
      },
      newOrders: { title: t("events.vendor.newOrders.title") },
      returns: {
        title: t("events.vendor.returns.title"),
        hint: t("events.vendor.returns.hint"),
      },
      preorderAccess: {
        title: t("events.vendor.preorderAccess.title"),
        hint: t("events.vendor.preorderAccess.hint"),
      },
    },
    customer: {
      orderUpdates: {
        title: t("events.customer.orderUpdates.title"),
        hint: t("events.customer.orderUpdates.hint"),
        guestsMiss: t("events.customer.orderUpdates.guestsMiss"),
      },
      returnUpdates: {
        title: t("events.customer.returnUpdates.title"),
        hint: t("events.customer.returnUpdates.hint"),
        guestsMiss: t("events.customer.returnUpdates.guestsMiss"),
      },
    },
  };

  const audienceLabel: Record<NotificationAudience, string> = {
    admin: t("audiences.admin"),
    staff: t("audiences.staff"),
    vendor: t("audiences.vendor"),
    customer: t("audiences.customer"),
  };
  const who: Record<NotificationAudience, string> = {
    admin: t("who.admin"),
    staff: t("who.staff"),
    vendor: t("who.vendor"),
    customer: t("who.customer"),
  };

  /** What a column means for the people on this tab. */
  const tip = (audience: NotificationAudience, channel: NotificationChannel) => {
    switch (channel) {
      case "inApp":
        return audience === "admin"
          ? t("tips.inApp.admin")
          : audience === "staff"
            ? t("tips.inApp.staff")
            : audience === "vendor"
              ? t("tips.inApp.vendor")
              : t("tips.inApp.customer");
      case "email":
        return t("tips.email");
      case "browserPush":
        return audience === "customer"
          ? t("tips.browserPush.customer")
          : t("tips.browserPush.team");
      case "sms":
        return audience === "vendor"
          ? t("tips.sms.vendor")
          : audience === "customer"
            ? t("tips.sms.customer")
            : t("tips.sms.team");
    }
  };

  const toggle = (
    audience: NotificationAudience,
    event: string,
    channel: NotificationChannel,
    checked: boolean,
  ) => updateNestedField(`notifications.${audience}.${event}.${channel}`, checked);

  const emailLink = (chunks: ReactNode) => (
    <Link href="/admin/settings/email" className={warningLinkClass}>
      {chunks}
    </Link>
  );
  const smsLink = (chunks: ReactNode) => (
    <Link href="/admin/settings/sms" className={warningLinkClass}>
      {chunks}
    </Link>
  );

  const warnings = [
    !ready.email && emailTicked > 0 ? (
      <WarningBanner key="email">
        {t.rich("warnings.email", { link: emailLink })}
      </WarningBanner>
    ) : null,
    !ready.sms && smsTicked > 0 ? (
      <WarningBanner key="sms">
        {t.rich("warnings.sms", { count: smsTicked, link: smsLink })}
      </WarningBanner>
    ) : null,
    !ready.browserPush && pushTicked > 0 ? (
      <WarningBanner key="push">{t("warnings.push")}</WarningBanner>
    ) : null,
  ].filter(Boolean);

  // Columns are as wide as the card allows: a phone fits four beside a name.
  const gridStyle = {
    gridTemplateColumns: `minmax(0, 1fr) repeat(${channels.length}, var(--channel-col))`,
  } as CSSProperties;

  const staffNobody = staffAudience !== null && staffAudience.total === 0;

  return (
    <div className="space-y-4">
      <SettingsTabHeader title={t("title")} description={t("description")}>
        {warnings.length > 0 ? <div className="space-y-2.5">{warnings}</div> : null}
      </SettingsTabHeader>

      <Card className="@container gap-0 py-0">
        <Tabs
          value={tab}
          onValueChange={(value) => setPicked(value as NotificationAudience)}
        >
          {/* The menu sits beside the tabs, not over them: on a phone the
              tabs scroll, and the last one slid under it, out of reach. */}
          <div className="flex items-stretch">
            <div className="min-w-0 flex-1 px-1">
              <UnderlineTabsList
                aria-label={t("audiencesLabel")}
                className="gap-0 ps-2 @md:gap-1 @md:ps-4"
              >
                {audiences.map((audience) => (
                  <UnderlineTabsTrigger key={audience} value={audience} className={TAB_CLASS}>
                    {audienceLabel[audience]}
                    {audienceChanged(notifications, savedSettings.notifications, audience) ? (
                      <>
                        <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
                        <span className="sr-only">{tSaveBar("unsaved")}</span>
                      </>
                    ) : null}
                  </UnderlineTabsTrigger>
                ))}
              </UnderlineTabsList>
            </div>
            <div className="flex shrink-0 items-center border-b ps-1 pe-2 @md:pe-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-8"
                    aria-label={t("moreOptions")}
                  >
                    <MoreVertical aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem
                    className="items-start gap-2.5"
                    onSelect={() =>
                      updateNestedField("notifications", recommendedNotificationSettings())
                    }
                  >
                    <RotateCcw aria-hidden className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="block font-medium">{t("restore")}</span>
                      <span className="text-muted-foreground block text-xs">
                        {t("restoreHint")}
                      </span>
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {audiences.map((audience) => {
            const events = Object.keys(copy[audience]).filter((event) =>
              eventShows(audience, event, store),
            );
            return (
              <TabsContent
                key={audience}
                value={audience}
                className="space-y-4 px-3 pt-4 pb-5 @md:px-6 @md:pt-5 @md:pb-6"
              >
                <Note icon={Users}>
                  {who[audience]}
                  {audience === "staff" ? (
                    <>
                      {" "}
                      <Link href="/admin/staff" className={linkClass}>
                        {t("teamLink")}
                      </Link>
                    </>
                  ) : null}
                </Note>
                {audience === "staff" && staffNobody ? (
                  <Note icon={Info}>{t("noStaff")}</Note>
                ) : null}

                <div
                  role="table"
                  aria-label={audienceLabel[audience]}
                  className="rounded-lg border [--channel-col:2.875rem] @xl:[--channel-col:5.5rem]"
                >
                  <div
                    role="row"
                    className="bg-muted/40 grid min-h-13 items-center rounded-t-lg px-3 @xl:min-h-10 @xl:px-5"
                    style={gridStyle}
                  >
                    {/* Holds the first column: sr-only alone would take the
                        heading out of the grid and shift every channel left. */}
                    <span role="columnheader" className="min-w-0">
                      <span className="sr-only">{t("event")}</span>
                    </span>
                    {channels.map((channel) => (
                      <span key={channel} role="columnheader" className="flex justify-center">
                        <ChannelHeader
                          channel={channel}
                          label={tSettings(`notifications.channels.${channel}`)}
                          tip={tip(audience, channel)}
                          ready={ready[channel]}
                        />
                      </span>
                    ))}
                  </div>

                  {events.map((event) => {
                    const row = copy[audience][event];
                    const values = channelsOf(notifications, audience, event);
                    // Only an exception earns a line in amber: a row nobody
                    // receives, or guests left hearing nothing at all.
                    const nobody =
                      audience === "staff" &&
                      staffAudience !== null &&
                      !staffNobody &&
                      staffAudience.events[event as keyof StaffNotificationAudience["events"]] === 0
                        ? row.nobody
                        : undefined;
                    const guestsMiss =
                      row.guestsMiss && !guestsHearOf(values, ready.sms)
                        ? row.guestsMiss
                        : undefined;
                    const caution = nobody ?? guestsMiss;
                    return (
                      <div
                        key={event}
                        role="row"
                        className="grid items-center border-t px-3 py-1.5 @xl:px-5"
                        style={gridStyle}
                      >
                        <div role="rowheader" className="min-w-0 space-y-0.5 py-1 pe-3">
                          <p className="text-sm font-medium">{row.title}</p>
                          {caution ? (
                            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                              <Info aria-hidden className="mt-px size-3.5 shrink-0" />
                              <span>{caution}</span>
                            </p>
                          ) : row.hint ? (
                            <p className="text-muted-foreground text-xs">{row.hint}</p>
                          ) : null}
                        </div>
                        {channels.map((channel) => (
                          <span key={channel} role="cell" className="flex justify-center">
                            <label className="flex h-10 w-11 cursor-pointer items-center justify-center">
                              <Checkbox
                                checked={values[channel]}
                                onCheckedChange={(checked) =>
                                  toggle(audience, event, channel, checked)
                                }
                                aria-label={`${row.title}: ${tSettings(`notifications.channels.${channel}`)}`}
                                className={cn(
                                  "size-[18px] rounded-[5px]",
                                  // Ticked, but the channel cannot send yet.
                                  !ready[channel] &&
                                    "data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground",
                                )}
                              />
                            </label>
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>

                {showSms ? null : (
                  <Note icon={MessageSquareText}>
                    {t.rich("notes.smsHidden", {
                      link: (chunks) => (
                        <Link href="/admin/settings/sms" className={linkClass}>
                          {chunks}
                        </Link>
                      ),
                    })}
                  </Note>
                )}
                {audience === "admin" ? (
                  <Note icon={Info}>{t("notes.paymentProblems")}</Note>
                ) : null}
                {audience === "customer" ? (
                  <>
                    <Note icon={Info}>{t("notes.orderConfirmation")}</Note>
                    <Note icon={Info}>{t("notes.shopperOptOut")}</Note>
                  </>
                ) : null}
              </TabsContent>
            );
          })}
        </Tabs>
      </Card>

      <StickySaveFooter
        label={tSettings("saveChanges")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      />
    </div>
  );
}

/** A quiet line with its icon: who a tab reaches, or a fact about it. */
function Note(props: { icon: LucideIcon; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}
