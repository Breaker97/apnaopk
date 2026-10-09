"use client";

import { useTranslations } from "next-intl";
import { appBaseUrl } from "@/lib/app-url";
import { orderStatusMessage } from "@/lib/notifications/order-status-messages";
import { normalizeOrderPrefix } from "@/lib/orders/order-settings";
import {
  buildNotificationSmsBody,
  measureSmsText,
  smsStoreName,
} from "@/lib/sms/sms-text";
import { cn } from "@/lib/utils";

/** The number after the prefix; lib/orders/order-number.ts pads to six digits. */
const SAMPLE_ORDER_SEQUENCE = "000124";
/** An order id, for the link's length: a real text carries the order's own. */
const SAMPLE_ORDER_ID = "66f2a0c4e1b2c3d4e5f60718";

/**
 * The text a customer gets when an order is delivered (the longest of the
 * order updates), built the way a real one is, with what it is billed as.
 *
 * "A link often pushes a message into a second segment" used to be all the
 * page said. Here the merchant sees the link do it, and what a store name
 * outside the GSM alphabet (Bengali, Arabic) does to every text.
 */
export function SmsMessagePreview(props: {
  storeName?: string;
  orderPrefix?: string;
  includeLink: boolean;
}) {
  const t = useTranslations("admin.settings.sms");
  const storeName = smsStoreName(props.storeName);
  const link = `${appBaseUrl()}/account/orders/${SAMPLE_ORDER_ID}`;
  const body = buildNotificationSmsBody({
    storeName,
    message: orderStatusMessage(
      "delivered",
      `${normalizeOrderPrefix(props.orderPrefix)}${SAMPLE_ORDER_SEQUENCE}`,
    ),
    link: props.includeLink ? link : undefined,
  });
  const measure = measureSmsText(body);
  // Drawn apart from the words, so the merchant sees what the switch adds.
  const linked = props.includeLink && body.endsWith(link);
  const words = linked ? body.slice(0, body.length - link.length) : body;
  const nameOutsideGsm = measureSmsText(storeName).encoding === "UCS-2";

  return (
    <div className="bg-muted/40 mx-4 mb-4 space-y-2 rounded-xl p-3.5">
      <p className="text-muted-foreground text-xs font-medium">{t("previewCaption")}</p>
      <p
        dir="auto"
        className="bg-muted max-w-md rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm [overflow-wrap:anywhere]"
      >
        {words}
        {linked ? <span className="text-primary underline">{link}</span> : null}
      </p>
      <p
        className={cn(
          "text-xs",
          measure.segments > 1
            ? "font-medium text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {t("previewCount", {
          characters: measure.characters,
          segments: measure.segments,
        })}
      </p>
      {nameOutsideGsm ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t("previewUnicode")}</p>
      ) : null}
    </div>
  );
}
