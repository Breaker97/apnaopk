"use client";

import { useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderCheckoutField } from "@/types";

interface OrderCheckoutAnswersProps {
  customerNote?: string;
  checkoutFields?: OrderCheckoutField[];
  className?: string;
}

/**
 * What the shopper told the store at checkout: their order note and the
 * answers to the store's own checkout fields. The labels are the ones the
 * order was placed with, so a field renamed or deleted since still reads
 * right. Shared by the admin, vendor and customer order pages.
 */
export function OrderCheckoutAnswers({
  customerNote,
  checkoutFields,
  className,
}: OrderCheckoutAnswersProps) {
  const t = useTranslations();
  const tr = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const fields = (checkoutFields ?? []).filter((field) => field.value);
  const note = customerNote?.trim();
  if (!note && fields.length === 0) return null;

  const display = (field: OrderCheckoutField) =>
    field.type === "checkbox"
      ? field.value === "true"
        ? tr("common.yes", "Yes")
        : tr("common.no", "No")
      : field.value;

  return (
    <Card className={className ?? "gap-4"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" />
          {tr("checkout.additionalInformation", "Additional information")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {fields.map((field) => (
          <div key={field.key}>
            <p className="text-muted-foreground">{field.label}</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words font-medium">
              {display(field)}
            </p>
          </div>
        ))}
        {note ? (
          <div>
            <p className="text-muted-foreground">
              {tr("checkout.orderNote", "Order note")}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words">{note}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
