import { setRequestLocale } from "next-intl/server";
import { VendorExpenses } from "@/components/vendor/finance/vendor-expenses";
import { guardVendorFinance } from "@/lib/finance/vendor-page-data";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * A vendor's own costs, on their own screen.
 *
 * They deliberately do not appear on the statement: nothing here changes what
 * the marketplace owes, and mixing them into the balance would suggest it does.
 */
export default async function VendorExpensesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { storeCurrency } = await guardVendorFinance(locale);

  return <VendorExpenses storeCurrency={storeCurrency} />;
}
