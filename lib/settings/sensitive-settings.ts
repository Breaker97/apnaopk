import { ADMIN_AREA_PERMISSIONS as A } from "@/config/team-permissions.config";
import { CREDENTIAL_FIELD_PATHS } from "@/lib/settings/credential-fields";

/**
 * Which settings saves need a team role's `manage_sensitive_settings`
 * (config/team-permissions.config.ts): the sections that hold the store's
 * secrets or decide who gets in, and — in any other section — a save that
 * actually changes a stored credential (a carrier token, the analytics key …).
 * An empty string keeps a credential as it is (the forms send one for an
 * untouched secret), so it is no change; a value or `null` (clear) is.
 */
export const SENSITIVE_SETTINGS_SECTIONS: ReadonlySet<string> = new Set([
  "payment",
  "security",
  "storage",
  "email",
  "sms",
]);

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function isSensitiveSettingsSave(section: string | undefined, data: unknown): boolean {
  // A save without a section can change anything.
  if (!section) return true;
  if (SENSITIVE_SETTINGS_SECTIONS.has(section)) return true;
  const prefix = `${section}.`;
  return CREDENTIAL_FIELD_PATHS.some((path) => {
    if (!path.startsWith(prefix)) return false;
    const value = readPath(data, path.slice(prefix.length).split("."));
    return value === null || (typeof value === "string" && value.trim() !== "");
  });
}

/**
 * The settings sections another admin area's screens save: that area's Manage
 * permission saves them as well as `manage_settings` (the header, footer and
 * pages are Online Store screens; the sales agent and boost settings are
 * theirs).
 */
const SECTION_AREAS: Readonly<Record<string, string>> = {
  appearance: A.MANAGE_ONLINE_STORE,
  sliderTemplates: A.MANAGE_ONLINE_STORE,
  header: A.MANAGE_ONLINE_STORE,
  footer: A.MANAGE_ONLINE_STORE,
  checkout: A.MANAGE_ONLINE_STORE,
  productCard: A.MANAGE_ONLINE_STORE,
  homePage: A.MANAGE_ONLINE_STORE,
  contentPages: A.MANAGE_ONLINE_STORE,
  aiSalesAgent: A.MANAGE_AI_AGENT,
  boosting: A.MANAGE_BOOSTS,
  vendorConfig: A.MANAGE_VENDORS,
};

/**
 * What a team role must hold (any one) to save `section` with `data`: a
 * sensitive save needs `manage_sensitive_settings`; a section another area
 * owns, that area's Manage or `manage_settings`; any other, `manage_settings`.
 */
export function settingsSavePermissions(section: string | undefined, data: unknown): readonly string[] {
  if (isSensitiveSettingsSave(section, data)) return [A.MANAGE_SENSITIVE_SETTINGS];
  const area = section ? SECTION_AREAS[section] : undefined;
  return area ? [A.MANAGE_SETTINGS, area] : [A.MANAGE_SETTINGS];
}
