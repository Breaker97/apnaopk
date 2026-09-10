import "server-only";

import { cache } from "react";
import { Types } from "mongoose";
import {
  ChannelConnection,
  type MessageProvider,
} from "@/models/channel-connection.model";
import {
  DEFAULT_BUSINESS_HOURS,
  PlatformMessagingSettings,
  type IBusinessHour,
} from "@/models/platform-messaging-settings.model";
import type { VendorMessagingSettings } from "@/lib/notifications/vendor-messaging";

/**
 * The PUBLIC storefront shape. It is embedded in unauthenticated product and
 * vendor payloads and therefore serialized into the browser, so it deliberately
 * carries nothing beyond what the chat widget renders — no escalation address,
 * no schedule, no operational configuration. Admin surfaces read the full
 * record through `getPlatformMessagingConfiguration` instead.
 */
interface PlatformMessagingSettingsDTO
  extends VendorMessagingSettings {
  liveChatOnline: boolean;
  primaryColor: string;
  offlineMessage: string;
}

function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

function minuteOfDay(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isLiveChatOnline(params: {
  enabled: boolean;
  mode: "always" | "business_hours";
  timezone: string;
  businessHours: IBusinessHour[];
  now?: Date;
}) {
  if (!params.enabled) return false;
  if (params.mode === "always") return true;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimezone(params.timezone),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(params.now || new Date())
      .map((part) => [part.type, part.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday,
  );
  const schedule = params.businessHours.find((entry) => entry.day === day);
  if (!schedule?.enabled) return false;
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const start = minuteOfDay(schedule.start);
  const end = minuteOfDay(schedule.end);
  return end > start
    ? current >= start && current < end
    : current >= start || current < end;
}

async function getConfigDocument() {
  // Deliberately create() rather than an upsert. `findOneAndUpdate({}, {
  // $setOnInsert: {} }, { upsert: true })` looks more atomic, but Mongoose
  // strips the empty operator and sends `{}` — which findOneAndUpdate treats as
  // a REPLACEMENT, so the first storefront render would blank the admin's saved
  // configuration. `setDefaultsOnInsert` also does not inject the schema
  // defaults into the update, so an upsert-inserted row would come out
  // half-populated where create({}) fills it completely.
  //
  // Two cold-start requests can therefore still race and insert two singleton
  // rows. That is pre-existing and low-impact (both rows hold the same
  // defaults, and getSettings() has the same shape), and it is not worth
  // risking the read path to close.
  return (
    (await PlatformMessagingSettings.findOne()) ||
    (await PlatformMessagingSettings.create({}))
  );
}

async function loadPlatformMessagingConfiguration() {
  const config = await getConfigDocument();
  const businessHours = Array.isArray(config.businessHours)
    ? config.businessHours.map((entry) => ({
        day: entry.day,
        enabled: entry.enabled,
        start: entry.start,
        end: entry.end,
      }))
    : DEFAULT_BUSINESS_HOURS;
  return {
    liveChatEnabled: config.liveChatEnabled,
    availabilityMode: config.availabilityMode,
    timezone: validTimezone(config.timezone),
    businessHours,
    primaryColor: config.primaryColor,
    offlineMessage: config.offlineMessage,
    escalationEnabled: config.escalationEnabled,
    escalationAfterMinutes: config.escalationAfterMinutes,
    escalationEmail: config.escalationEmail || "",
  };
}

/**
 * Live-chat configuration, memoized per server request — the same `cache()`
 * treatment `getSettings()` gets, and for the same reason.
 *
 * This is read on every storefront product and vendor render (through
 * `getPlatformMessagingSettings`) and again on every chat start, each issuing
 * its own `findOne` for one singleton document. The memo is per request, so an
 * admin's save is visible on the very next one.
 */
export const getPlatformMessagingConfiguration = cache(
  loadPlatformMessagingConfiguration,
);

export async function updatePlatformMessagingConfiguration(params: {
  liveChatEnabled: boolean;
  availabilityMode: "always" | "business_hours";
  timezone: string;
  businessHours: IBusinessHour[];
  primaryColor: string;
  offlineMessage: string;
  escalationEnabled: boolean;
  escalationAfterMinutes: number;
  escalationEmail?: string;
  userId: string;
}) {
  const config = await PlatformMessagingSettings.findOneAndUpdate(
    {},
    {
      $set: {
        ...params,
        timezone: validTimezone(params.timezone),
        updatedByUserId: new Types.ObjectId(params.userId),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return {
    liveChatEnabled: config.liveChatEnabled,
    availabilityMode: config.availabilityMode,
    timezone: config.timezone,
    businessHours: config.businessHours,
    primaryColor: config.primaryColor,
    offlineMessage: config.offlineMessage,
    escalationEnabled: config.escalationEnabled,
    escalationAfterMinutes: config.escalationAfterMinutes,
    escalationEmail: config.escalationEmail || "",
  };
}

export async function getPlatformMessagingSettings(): Promise<PlatformMessagingSettingsDTO> {
  const [connections, config] = await Promise.all([
    ChannelConnection.find({
      ownerKey: "platform",
      status: "active",
    })
      .select(
        "provider publicPhoneNumberE164 publicPageUsername publicInstagramUsername publicTelegramUsername",
      )
      .lean<
        Array<{
          provider: MessageProvider;
          publicPhoneNumberE164?: string;
          publicPageUsername?: string;
          publicInstagramUsername?: string;
          publicTelegramUsername?: string;
        }>
      >(),
    getPlatformMessagingConfiguration(),
  ]);
  const byProvider = (provider: MessageProvider) =>
    connections.find((connection) => connection.provider === provider);
  const whatsapp = byProvider("whatsapp");
  const messenger = byProvider("messenger");
  const instagram = byProvider("instagram");
  const telegram = byProvider("telegram");
  // Explicit field pick, never `...config` — spreading leaked escalationEmail,
  // escalationAfterMinutes and the business-hours schedule into the public
  // product payload.
  return {
    liveChatEnabled: config.liveChatEnabled,
    primaryColor: config.primaryColor,
    offlineMessage: config.offlineMessage,
    liveChatOnline: isLiveChatOnline({
      enabled: config.liveChatEnabled,
      mode: config.availabilityMode,
      timezone: config.timezone,
      businessHours: config.businessHours,
    }),
    whatsapp: {
      enabled: Boolean(whatsapp?.publicPhoneNumberE164),
      phoneNumberE164: whatsapp?.publicPhoneNumberE164 || "",
    },
    messenger: {
      enabled: Boolean(messenger?.publicPageUsername),
      pageUsername: messenger?.publicPageUsername || "",
    },
    instagram: {
      enabled: Boolean(instagram?.publicInstagramUsername),
      username: instagram?.publicInstagramUsername || "",
    },
    telegram: {
      enabled: Boolean(telegram?.publicTelegramUsername),
      username: telegram?.publicTelegramUsername || "",
    },
  };
}
