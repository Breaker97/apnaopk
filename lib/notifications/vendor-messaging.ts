export interface VendorMessagingSettings {
  liveChatEnabled: boolean;
  liveChatOnline?: boolean;
  primaryColor?: string;
  offlineMessage?: string;
  whatsapp: {
    enabled: boolean;
    phoneNumberE164: string;
  };
  messenger: {
    enabled: boolean;
    pageUsername: string;
  };
  instagram: {
    enabled: boolean;
    username: string;
  };
  telegram: {
    enabled: boolean;
    username: string;
  };
}

export const DEFAULT_VENDOR_MESSAGING: VendorMessagingSettings = {
  // Live chat is available to existing vendors without a migration. External
  // channels remain opt-in because their identifiers are published publicly.
  liveChatEnabled: true,
  whatsapp: {
    enabled: false,
    phoneNumberE164: "",
  },
  messenger: {
    enabled: false,
    pageUsername: "",
  },
  instagram: {
    enabled: false,
    username: "",
  },
  telegram: {
    enabled: false,
    username: "",
  },
};

export function normalizeWhatsAppNumber(value: unknown) {
  if (typeof value !== "string") return "";
  const digits = value.replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
}

export function normalizeMessengerUsername(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const fromUrl = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:m\.me|facebook\.com)\/([^/?#]+)/i,
  )?.[1];
  const username = (fromUrl || trimmed).replace(/^@/, "");
  return /^[a-zA-Z0-9._-]{2,100}$/.test(username) ? username : "";
}

export function normalizeInstagramUsername(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const fromUrl = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:ig\.me\/m|instagram\.com)\/([^/?#]+)/i,
  )?.[1];
  const username = (fromUrl || trimmed).replace(/^@/, "");
  // Instagram handles are letters, digits, periods and underscores, max 30.
  return /^[a-zA-Z0-9._]{1,30}$/.test(username) ? username : "";
}

export function normalizeTelegramUsername(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const fromUrl = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^/?#]+)/i,
  )?.[1];
  const username = (fromUrl || trimmed).replace(/^@/, "");
  // Telegram usernames are 5-32 chars of letters, digits and underscores.
  return /^[a-zA-Z0-9_]{5,32}$/.test(username) ? username : "";
}

export function resolveVendorMessaging(
  value: unknown,
): VendorMessagingSettings {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const whatsapp =
    source.whatsapp && typeof source.whatsapp === "object"
      ? (source.whatsapp as Record<string, unknown>)
      : {};
  const messenger =
    source.messenger && typeof source.messenger === "object"
      ? (source.messenger as Record<string, unknown>)
      : {};
  const instagram =
    source.instagram && typeof source.instagram === "object"
      ? (source.instagram as Record<string, unknown>)
      : {};
  const telegram =
    source.telegram && typeof source.telegram === "object"
      ? (source.telegram as Record<string, unknown>)
      : {};

  return {
    liveChatEnabled: source.liveChatEnabled !== false,
    ...(typeof source.liveChatOnline === "boolean"
      ? { liveChatOnline: source.liveChatOnline }
      : {}),
    ...(typeof source.primaryColor === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(source.primaryColor)
      ? { primaryColor: source.primaryColor }
      : {}),
    ...(typeof source.offlineMessage === "string" &&
    source.offlineMessage.trim()
      ? { offlineMessage: source.offlineMessage.trim().slice(0, 500) }
      : {}),
    whatsapp: {
      enabled: whatsapp.enabled === true,
      phoneNumberE164: normalizeWhatsAppNumber(whatsapp.phoneNumberE164),
    },
    instagram: {
      enabled: instagram.enabled === true,
      username: normalizeInstagramUsername(instagram.username),
    },
    telegram: {
      enabled: telegram.enabled === true,
      username: normalizeTelegramUsername(telegram.username),
    },
    messenger: {
      enabled: messenger.enabled === true,
      pageUsername: normalizeMessengerUsername(messenger.pageUsername),
    },
  };
}

export function vendorWhatsAppUrl(
  settings: VendorMessagingSettings,
  message?: string,
) {
  if (!settings.whatsapp.enabled || !settings.whatsapp.phoneNumberE164) {
    return undefined;
  }
  const digits = settings.whatsapp.phoneNumberE164.replace(/\D/g, "");
  const query = message?.trim()
    ? `?text=${encodeURIComponent(message.trim())}`
    : "";
  return `https://wa.me/${digits}${query}`;
}

export function vendorMessengerUrl(settings: VendorMessagingSettings) {
  if (!settings.messenger.enabled || !settings.messenger.pageUsername) {
    return undefined;
  }
  return `https://m.me/${encodeURIComponent(settings.messenger.pageUsername)}`;
}

export function vendorTelegramUrl(settings: VendorMessagingSettings) {
  if (!settings.telegram?.enabled || !settings.telegram.username) {
    return undefined;
  }
  return `https://t.me/${encodeURIComponent(settings.telegram.username)}`;
}

export function vendorInstagramUrl(settings: VendorMessagingSettings) {
  if (!settings.instagram?.enabled || !settings.instagram.username) {
    return undefined;
  }
  // ig.me/m is Instagram's click-to-chat entry point, the counterpart of m.me.
  return `https://ig.me/m/${encodeURIComponent(settings.instagram.username)}`;
}
