/**
 * What the Activity Log keeps of a vendor's bank account and store settings.
 *
 * Two routes record a change to the bank account — the admin's vendor editor and
 * the vendor's own settings page — and they go through here so both mask the same
 * way. `audit()` cannot do it for them: it redacts by key name, and a field called
 * `accountNumber` matches none of its patterns.
 */

/**
 * Keep an identifier auditable without storing it.
 *
 * Bank and tax numbers must show up in the change log — "who moved the payout
 * account" is exactly what an audit trail is for — but the log is a long-lived,
 * broadly-readable table, so only enough to recognise a value is retained.
 */
export function maskIdentifier(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= 4 ? "••••" : `••••${text.slice(-4)}`;
}

export const BANK_DETAIL_FIELDS = [
  "accountName",
  "accountNumber",
  "bankName",
  "routingNumber",
  "swiftCode",
] as const;

export type BankDetailField = (typeof BANK_DETAIL_FIELDS)[number];

/**
 * A vendor's bank details as the log may hold them: the account and routing
 * numbers cut to their last four digits, everything else as written.
 */
export function bankDetailsAuditSnapshot(
  bank: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const details = bank ?? {};
  return {
    accountName: details.accountName ?? "",
    accountNumber: maskIdentifier(details.accountNumber),
    bankName: details.bankName ?? "",
    routingNumber: maskIdentifier(details.routingNumber),
    swiftCode: details.swiftCode ?? "",
  };
}

const BANK_FIELD_LABEL: Record<BankDetailField, string> = {
  accountName: "account name",
  accountNumber: "account number",
  bankName: "bank name",
  routingNumber: "routing number",
  swiftCode: "SWIFT code",
};

/**
 * Which bank fields differ, judged on the real values.
 *
 * Not on the masked ones: a new account that happens to end in the same four
 * digits is still a new account. The values are only compared here, never kept.
 */
export function changedBankDetailFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): BankDetailField[] {
  const text = (details: Record<string, unknown> | null | undefined, field: BankDetailField) =>
    String(details?.[field] ?? "").trim();
  return BANK_DETAIL_FIELDS.filter((field) => text(before, field) !== text(after, field));
}

/** Names the fields, never the numbers in them. */
export function bankDetailsChangeSummary(fields: readonly BankDetailField[]): string {
  return `Payout bank details changed: ${fields.map((field) => BANK_FIELD_LABEL[field]).join(", ")}`;
}

/** The top-level keys whose values differ between two settings snapshots. */
export function changedSettingFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return Object.keys({ ...before, ...after }).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

const SETTING_LABEL: Record<string, string> = {
  storeName: "store name",
  slug: "store URL",
  description: "description",
  logo: "logo",
  banner: "banner",
  address: "address",
  socialProfiles: "social profiles",
  notificationPreferences: "notification preferences",
  payoutSettings: "payout schedule",
  shareSettings: "share buttons",
  storeVisibility: "what the store page shows",
  messaging: "chat channels",
  shipping: "shipping",
};

/** Names the settings groups that changed. */
export function vendorSettingsChangeSummary(fields: readonly string[]): string {
  return `Store settings changed: ${fields.map((field) => SETTING_LABEL[field] ?? field).join(", ")}`;
}

/**
 * Comparable form of the override set for the audit diff.
 *
 * Sorted and flattened to strings so `auditUpdate` reports "this permission
 * moved" rather than "the array changed", and so a save that touched nothing
 * still writes nothing.
 */
function overridesAuditValue(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const expiry = row.expiresAt
        ? new Date(String(row.expiresAt)).toISOString()
        : "never";
      return `${String(row.permission)}:${String(row.mode)}:${expiry}`;
    })
    .sort();
}

export interface VendorAuditSubject {
  status?: unknown;
  verified?: unknown;
  commission?: unknown;
  storeName?: unknown;
  slug?: unknown;
  description?: unknown;
  logo?: unknown;
  banner?: unknown;
  notes?: unknown;
  permissionOverrides?: unknown;
  address?: Record<string, unknown> | null;
  bankDetails?: Record<string, unknown> | null;
  documents?: Record<string, unknown> | null;
}

/**
 * Comparable snapshot of everything the admin's vendor save can change, for
 * its change diff (and the business app's decision, which writes the same).
 *
 * `auditUpdate` diffs the two snapshots and skips writing when nothing moved,
 * so this can be built unconditionally. Derived address fields (coordinates,
 * geo) are left out: they follow the address rather than being edited, and
 * including them would report a change on every re-geocode.
 */
export function vendorAuditSnapshot(
  vendor: VendorAuditSubject,
  owner: { name?: unknown; email?: unknown; phone?: unknown; status?: unknown },
): Record<string, unknown> {
  const address = (vendor.address ?? {}) as Record<string, unknown>;
  const documents = (vendor.documents ?? {}) as Record<string, unknown>;
  // Access deviations, not the legacy grant list. "Who gave this vendor POS,
  // and when" is only answerable from the change log if the log records the
  // field the decision is actually stored in.
  const permissionOverrides = overridesAuditValue(vendor.permissionOverrides);

  return {
    status: vendor.status ?? "",
    // Who awarded or withdrew the storefront badge, and when, is exactly the
    // kind of decision the change log exists for.
    verified: vendor.verified === true,
    commission: Number(vendor.commission ?? 0),
    storeName: vendor.storeName ?? "",
    slug: vendor.slug ?? "",
    description: vendor.description ?? "",
    logo: vendor.logo ?? "",
    banner: vendor.banner ?? "",
    notes: vendor.notes ?? "",
    permissionOverrides,
    address: {
      street: address.street ?? "",
      city: address.city ?? "",
      state: address.state ?? "",
      postalCode: address.postalCode ?? "",
      country: address.country ?? "",
      phone: address.phone ?? "",
    },
    bankDetails: bankDetailsAuditSnapshot(vendor.bankDetails),
    documents: {
      businessLicense: documents.businessLicense ?? "",
      taxId: maskIdentifier(documents.taxId),
      taxCertificate: documents.taxCertificate ?? "",
      governmentId: documents.governmentId ?? "",
    },
    ownerName: owner.name ?? "",
    ownerEmail: owner.email ?? "",
    ownerPhone: owner.phone ?? "",
    ownerStatus: owner.status ?? "",
  };
}
