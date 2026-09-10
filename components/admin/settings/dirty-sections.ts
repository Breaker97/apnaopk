import type { Settings } from "./types";
import { isPlainObject } from "@/lib/utils";

/**
 * Dirty tracking for the settings form: a section counts as changed when its
 * comparable shape differs from what was loaded. "Comparable" drops empty
 * strings, nulls and undefineds so a field cleared to "" does not read as a
 * change from an absent one — the API treats them the same.
 */
export function normalizeComparableValue(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item));
  }

  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const next = normalizeComparableValue(nestedValue);
      if (next !== undefined) normalized[key] = next;
    }
    return normalized;
  }

  return value;
}

function comparableJson(value: unknown) {
  return JSON.stringify(normalizeComparableValue(value));
}

function pickSecurityFields(
  settings: Settings,
  keys: Array<keyof Settings["security"]>,
) {
  const security = settings.security || {};
  return keys.reduce<Record<string, unknown>>((acc, key) => {
    acc[String(key)] = security[key];
    return acc;
  }, {});
}

export function getComparableSection(section: string, settings: Settings): unknown {
  if (section === "oauth") {
    return {
      ...pickSecurityFields(settings, [
        "googleOAuthEnabled",
        "googleClientId",
        "googleClientSecret",
        "facebookOAuthEnabled",
        "facebookAppId",
        "facebookAppSecret",
      ]),
      googleClientSecretSet: Boolean(
        settings._meta?.credentials?.["security.googleClientSecret"]?.set,
      ),
      facebookAppSecretSet: Boolean(
        settings._meta?.credentials?.["security.facebookAppSecret"]?.set,
      ),
    };
  }

  if (section === "twoFactor") {
    return pickSecurityFields(settings, [
      "twoFactorEnabled",
      "twoFactorRequiredForAdmin",
      "twoFactorRequiredForVendors",
      "twoFactorRequiredForStaff",
    ]);
  }

  if (section === "emailVerification") {
    return pickSecurityFields(settings, [
      "emailVerificationRequired",
      "emailVerificationForVendors",
    ]);
  }

  if (section === "security") {
    return pickSecurityFields(settings, [
      "sessionMaxAgeDays",
      "maxLoginAttempts",
      "lockoutDurationMinutes",
      "minPasswordLength",
      "requireUppercase",
      "requireNumbers",
      "requireSpecialChars",
    ]);
  }

  const key = section === "marketplace" ? "multiVendorMode" : section;
  return (settings as unknown as Record<string, unknown>)[key];
}

export function getEffectiveDirtySections(
  settings: Settings | null,
  initialSettings: Settings | null,
  dirtySectionHints: Set<string>,
) {
  const next = new Set<string>();
  if (!settings || !initialSettings) return next;

  for (const section of dirtySectionHints) {
    const current = getComparableSection(section, settings);
    const initial = getComparableSection(section, initialSettings);
    if (comparableJson(current) !== comparableJson(initial)) {
      next.add(section);
    }
  }

  return next;
}
