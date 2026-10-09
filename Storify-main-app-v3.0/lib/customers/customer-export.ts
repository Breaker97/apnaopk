import type { PipelineStage } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile } from "@/models";
import { MARKETING_CONSENT_STATE } from "@/config/app.config";
import { STATES } from "@/lib/intl/country-options";
import { countryCodeForValue } from "@/lib/intl/country-availability";
import { csvLine } from "@/lib/catalog/csv";
import { readEmailConsentState } from "@/lib/customers/marketing-consent";
import {
  buildAdminCustomerListConditions,
  matchStage,
  USER_UNWIND,
  type AdminCustomerListFilter,
} from "@/lib/customers/customer-list";
import {
  CUSTOMER_EXPORT_ONLY_HEADERS,
  CUSTOMER_TEMPLATE_COLUMNS,
} from "@/lib/customers/customer-import-format";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

/**
 * The customers list as a file: every customer the list's filters match, not
 * the page on screen, in the import template's columns — so a file taken out
 * of the store, edited in a spreadsheet and imported again lands back on the
 * same customers. Three columns follow for whoever reads it (the email
 * consent's actual state, orders and spend), which an import passes over.
 *
 * Every cell goes through `csvCell`: names, notes and tags are typed by
 * shoppers and staff, and a spreadsheet must not run one as a formula.
 */

/** The most rows one export carries — a few seconds of work, a few megabytes of file. */
export const CUSTOMER_EXPORT_MAX_ROWS = 100_000;

export const CUSTOMER_EXPORT_HEADERS = [
  ...CUSTOMER_TEMPLATE_COLUMNS.map((column) => column.header),
  ...CUSTOMER_EXPORT_ONLY_HEADERS,
];

type ExportAddress = {
  street?: string;
  apartment?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  isDefault?: boolean;
};

export type CustomerExportDoc = {
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  notes?: string;
  shippingAddress?: ExportAddress | null;
  emailMarketing?: { state?: string | null } | null;
  smsMarketing?: { state?: string | null } | null;
  marketingOptIn?: boolean;
  stats?: { totalOrders?: number; totalSpent?: number } | null;
  user?: {
    name?: string;
    email?: string;
    phone?: string;
    addresses?: ExportAddress[];
  } | null;
};

/** "California" back to "CA" where the country has a list; the stored text otherwise. */
function provinceCode(state: string | undefined, countryCode: string | undefined) {
  const text = state?.trim() ?? "";
  if (!text || !countryCode) return text;
  const region = (STATES[countryCode] ?? []).find(
    (option) => option.label.toLowerCase() === text.toLowerCase(),
  );
  return region?.value ?? text;
}

/** One customer as the export writes them, cell by cell in header order. */
export function customerExportRow(doc: CustomerExportDoc): Array<string | number> {
  const name = (doc.user?.name || doc.name || "").trim();
  const [firstName = "", ...rest] = name ? name.split(/\s+/) : [];
  const address =
    doc.shippingAddress ??
    doc.user?.addresses?.find((saved) => saved.isDefault) ??
    doc.user?.addresses?.[0] ??
    null;
  const countryCode = countryCodeForValue(address?.country) ?? undefined;
  const emailState = readEmailConsentState({
    emailMarketing: doc.emailMarketing as Parameters<typeof readEmailConsentState>[0]["emailMarketing"],
    marketingOptIn: doc.marketingOptIn,
  });
  const yesNo = (state: string | null | undefined) =>
    state === MARKETING_CONSENT_STATE.SUBSCRIBED ? "yes" : "no";

  return [
    firstName,
    rest.join(" "),
    doc.user?.email || doc.email || "",
    doc.user?.phone || doc.phone || "",
    yesNo(emailState),
    yesNo(doc.smsMarketing?.state),
    address?.street ?? "",
    address?.apartment ?? "",
    address?.city ?? "",
    provinceCode(address?.state, countryCode),
    countryCode ?? address?.country ?? "",
    address?.postalCode ?? "",
    address?.phone ?? "",
    (doc.tags ?? []).join(", "),
    doc.notes ?? "",
    emailState,
    doc.stats?.totalOrders ?? 0,
    doc.stats?.totalSpent ?? 0,
  ];
}

/** The user fields a row needs, joined after the list's own profile filters. */
const EXPORT_USER_LOOKUP: PipelineStage = {
  $lookup: {
    from: "user",
    localField: "userId",
    foreignField: "_id",
    as: "user",
    pipeline: [{ $project: { name: 1, email: 1, phone: 1, addresses: 1, status: 1 } }],
  },
};

/**
 * The file's lines, header first, for everyone `filter` matches as the list
 * would show them (a scoped team member gets their own customers only).
 */
export async function buildCustomerExport(
  filter: AdminCustomerListFilter,
  staffScope?: StaffAccessScope | null,
): Promise<{ lines: string[]; rowCount: number; truncated: boolean }> {
  await connectDB();
  const { profileConditions, userConditions } = await buildAdminCustomerListConditions(
    filter,
    staffScope,
  );

  const pipeline: PipelineStage[] = [];
  const profileMatch = matchStage(profileConditions);
  if (profileMatch) pipeline.push(profileMatch);
  pipeline.push(EXPORT_USER_LOOKUP, USER_UNWIND);
  const userMatch = matchStage(userConditions);
  if (userMatch) pipeline.push(userMatch);
  pipeline.push(
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: CUSTOMER_EXPORT_MAX_ROWS + 1 },
    {
      $project: {
        name: 1,
        email: 1,
        phone: 1,
        tags: 1,
        notes: 1,
        shippingAddress: 1,
        emailMarketing: 1,
        smsMarketing: 1,
        marketingOptIn: 1,
        stats: 1,
        user: 1,
      },
    },
  );

  const lines = [csvLine(CUSTOMER_EXPORT_HEADERS)];
  let rowCount = 0;
  let truncated = false;
  const cursor = CustomerProfile.aggregate<CustomerExportDoc>(pipeline).cursor({ batchSize: 500 });
  for await (const doc of cursor) {
    if (rowCount === CUSTOMER_EXPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
    lines.push(csvLine(customerExportRow(doc)));
    rowCount++;
  }
  await cursor.close().catch(() => undefined);
  return { lines, rowCount, truncated };
}
