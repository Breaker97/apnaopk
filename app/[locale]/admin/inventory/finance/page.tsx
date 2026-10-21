import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { InventoryPosition } from "@/models/inventory-position.model";
import { getLedgerCurrencies } from "@/lib/finance/reports";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { InventoryFinancePanel } from "@/components/admin/inventory-finance-panel";
export default async function InventoryFinancePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params; setRequestLocale(locale);
  const access = await requireAdminOrStaffPageAccess({ locale, required: [STAFF_PERMISSIONS.VIEW_INVENTORY] });
  await connectDB();
  const settings = await getSettings();
  const query = await searchParams;
  const readId = (key: string) => typeof query[key] === "string" && /^[a-f\d]{24}$/i.test(query[key]) ? query[key] as string : undefined;
  const currency = typeof query.currency === "string" && /^[A-Z]{3}$/.test(query.currency) ? query.currency : settings.general?.defaultCurrency ?? "USD";
  const currencies = [...new Set([...await getLedgerCurrencies(), ...await InventoryPosition.distinct("currency")])];
  const admin = access.session.user.role === "admin";
  const allowAdjust = admin || (access.staffPermissions ?? []).some((permission) => permission === STAFF_PERMISSIONS.EDIT_INVENTORY || permission === STAFF_PERMISSIONS.MANAGE_INVENTORY);
  return <InventoryFinancePanel currency={currency} currencies={currencies} allowFinance={admin} allowAdjust={allowAdjust} productId={readId("productId")} variantId={readId("variantId")} locationId={readId("locationId")} />;
}
