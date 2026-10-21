"use client";

import { useTranslations } from "next-intl";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OrderPrint } from "./use-order-print";

/**
 * **Print invoice** (D-10): shown only while the online category has a
 * default; the page's own Print stays beside it. When the template can't
 * print, `onLegacyPrint` runs (the page's Print) after the toast.
 */
export function PrintInvoiceButton({ print, onLegacyPrint }: { print: OrderPrint; onLegacyPrint: () => void }) {
  const t = useTranslations("admin.invoiceTemplates.orderPrint");
  if (!print.defaults?.online) return null;
  const busy = print.busy === "online";
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={print.busy !== null}
      data-action="print-invoice"
      onClick={() => {
        void print.printInvoice().then((printed) => {
          if (!printed) onLegacyPrint();
        });
      }}
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
      {t("printInvoice")}
    </Button>
  );
}
