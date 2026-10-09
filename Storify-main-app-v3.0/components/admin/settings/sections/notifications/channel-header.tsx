"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  Mail,
  MessageSquareText,
  MonitorSmartphone,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { NotificationChannel } from "./notification-audiences";

const CHANNEL_ICONS: Record<NotificationChannel, LucideIcon> = {
  inApp: Bell,
  email: Mail,
  browserPush: MonitorSmartphone,
  sms: MessageSquareText,
};

/**
 * A channel's column heading. What the channel means for this audience opens
 * on hover, and on a tap where there is no hover; an amber dot marks a channel
 * that cannot send yet, its ticks then sending nothing.
 */
export function ChannelHeader(props: {
  channel: NotificationChannel;
  label: string;
  tip: string;
  ready: boolean;
}) {
  const t = useTranslations("admin.settings.notifications");
  const [open, setOpen] = useState(false);
  const Icon = CHANNEL_ICONS[props.channel];
  const notSetUp = props.ready ? "" : `${t("channelNotSetUp")} `;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${props.label}. ${notSetUp}${props.tip}`}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex flex-col items-center gap-1 rounded-md px-0.5 py-1 text-[11px] leading-4 font-medium outline-none focus-visible:ring-[3px] @xl:flex-row @xl:gap-1.5 @xl:text-xs"
        >
          <span className="relative flex">
            <Icon aria-hidden className="size-3.5" />
            {props.ready ? null : (
              <span
                aria-hidden
                className="ring-muted absolute -end-1 -top-0.5 size-1.5 rounded-full bg-amber-500 ring-2"
              />
            )}
          </span>
          <span>{props.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        className="w-60 space-y-1 p-3 text-xs leading-relaxed"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {props.ready ? null : (
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {t("channelNotSetUp")}
          </p>
        )}
        <p>{props.tip}</p>
      </PopoverContent>
    </Popover>
  );
}
