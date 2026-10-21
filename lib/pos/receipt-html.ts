import { buildCode39SVG } from "@/lib/pos/code39";

/**
 * The till's printed receipt: an 80 mm page of HTML, written into a hidden
 * iframe and printed by `printReceipt` in components/pos/pos-terminal.tsx.
 *
 * A pure function of the sale's payload and the store's details, so what the
 * customer walks out with can be tested (tests/pos-receipt-html.test.ts). The
 * QR code is passed in already drawn: drawing it is asynchronous and the URL
 * it points to depends on the page it is printed from.
 */

export interface ReceiptPrintPayload {
  orderNumber: string;
  createdAt: string | Date;
  /**
   * The counter this sale was rung up at.
   *
   * Printed because the receipt is the only record the customer walks out with,
   * and a multi-branch merchant handling a return has to know which shop's
   * stock the units came off. Absent when the register sells from shared stock,
   * where naming a branch would be a guess.
   */
  locationName?: string;
  /** The tender's name, or "Split" for a sale paid in more than one way. */
  paymentMethod: string;
  /** Each tender, as the receipt lists it. */
  payments?: Array<{ label: string; amount: number }>;
  cashTendered?: number;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    amount: number;
  }>;
  subtotal: number;
  tax: number;
  /**
   * How the tax line reads: added on top, already inside the prices, or not
   * charged (a tax-exempt sale, with its reason). Absent reads as added.
   */
  taxMode?: "added" | "included" | "exempt";
  taxExemptReason?: string;
  discount: number;
  total: number;
  balanceReturned: number;
  /** A deposit sale: what is still owed, printed so the customer knows. */
  balanceDue?: number;
}

export interface ReceiptHtmlOptions {
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  storeEmail?: string;
  /** The store's locale: the date is written the way it reads there. */
  locale?: string;
  /** The till's money formatter. */
  formatMoney: (amount: number) => string;
  /** The tax line's label in the cashier's language. */
  labels: { tax: string; taxIncluded: string; taxExempt: string };
  /** The QR code to the order's tracking page, as a data URL. */
  qrSrc: string;
  /** Pins the printed time to one zone (tests); the device's own by default. */
  timeZone?: string;
}

/** Where the receipt's QR code sends the customer: the order's tracking page. */
export function receiptOrderUrl(origin: string, locale: string | undefined, orderNumber: string): string {
  return `${origin}/${encodeURIComponent(
    locale || "en",
  )}/track-order?orderNumber=${encodeURIComponent(orderNumber)}`;
}

export function buildReceiptHtml(receipt: ReceiptPrintPayload, options: ReceiptHtmlOptions): string {
  const fp = options.formatMoney;
  const qrSrc = options.qrSrc;
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const dateText = new Intl.DateTimeFormat(options.locale || "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(new Date(receipt.createdAt));

  // Use a compact Code 128 symbol for the order lookup value. The
  // backwards-compatible helper name is retained for older callers.
  const barcodeValue = receipt.orderNumber.replace(/[^A-Za-z0-9]/g, "");
  const barcodeSVG = buildCode39SVG(barcodeValue, {
    height: 40,
    narrow: 1,
    wideRatio: 2.5,
    showText: true,
  });

  // Already the tender's translated name (or "Split"): see `processPayment`.
  const paymentLabel = receipt.paymentMethod;

  // One tax line, as the sale charged it: added on top, inside the
  // prices, or not at all (an exempt sale, with its reason).
  const taxRow =
    receipt.taxMode === "exempt"
      ? `<div class="r"><span>${escapeHtml(options.labels.taxExempt)}</span><span>${
          receipt.tax > 0 ? `-${fp(receipt.tax)}` : fp(0)
        }</span></div>${
          receipt.taxExemptReason
            ? `<div class="r"><span>${escapeHtml(receipt.taxExemptReason)}</span><span></span></div>`
            : ""
        }`
      : receipt.tax > 0
        ? `<div class="r"><span>${escapeHtml(
            receipt.taxMode === "included" ? options.labels.taxIncluded : options.labels.tax,
          )}</span><span>${fp(receipt.tax)}</span></div>`
        : "";
  const itemRows = receipt.items
    .map(
      (item) => `
          <tr>
            <td class="qty">${item.quantity}</td>
            <td class="name">${escapeHtml(item.name)}</td>
            <td class="money">${fp(item.price)}</td>
            <td class="money">${fp(item.amount)}</td>
          </tr>
        `,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt #${escapeHtml(receipt.orderNumber)}</title>
  <style>
    html, body { background: #fff; color: #000; width: 80mm; min-width: 80mm; max-width: 80mm; }
    body { font-family: 'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin: 0 auto; padding: 0; }
    .receipt { width: 80mm; max-width: 80mm; margin: 0; padding: 4mm 2.5mm; box-sizing: border-box; font-size: 10px; line-height: 1.25; color: #000; }
    .center { text-align: center; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .store { font-size: 13px; font-weight: 800; line-height: 1.1; margin: 0; letter-spacing: 0.3px; text-transform: uppercase; }
    .meta { font-size: 9px; line-height: 1.25; margin: 2px 0 0; }
    .meta div { word-break: break-word; }
    .dash { border-top: 1px dashed #000; margin: 5px 0; }
    .info { font-size: 9px; }
    .info .line { display: flex; justify-content: space-between; margin: 0; gap: 6px; }
    .info .line .lbl { color: #000; }
    .info .line .val { font-weight: 700; }
    .items { width: 100%; border-collapse: collapse; font-size: 9px; }
    .items th { border-bottom: 1px solid #000; padding: 3px 1px; text-align: left; font-weight: 800; text-transform: uppercase; font-size: 8px; letter-spacing: 0.2px; }
    .items td { padding: 3px 1px; vertical-align: top; }
    .items .qty { width: 24px; text-align: center; }
    .items .name { word-break: break-word; line-height: 1.2; }
    .items .money { text-align: right; white-space: nowrap; padding-left: 4px; }
    .totals { margin-top: 4px; font-size: 9px; }
    .totals .r { display: flex; justify-content: space-between; margin: 2px 0; gap: 8px; }
    .totals .r span:last-child { white-space: nowrap; }
    .totals .grand { font-size: 12px; font-weight: 800; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; margin-top: 4px; letter-spacing: 0.3px; }
    .totals .grand span:last-child { font-size: 13px; }
    .thanks { font-size: 10px; text-align: center; margin: 6px 0 2px; font-weight: 700; }
    .footer-note { font-size: 8px; text-align: center; margin: 0; color: #000; }
    .barcode-wrap { width: 100%; max-width: 58mm; margin: 6px auto 2px; }
    .barcode-wrap svg { display: block; width: 100%; height: auto; }
    .qr-wrap { display: flex; flex-direction: column; align-items: center; margin: 5px 0 0; }
    .qr-wrap img { width: 64px; height: 64px; display: block; }
    .scan-text { font-size: 8px; text-align: center; margin-top: 3px; color: #000; }
    @media screen {
      html, body { margin: 0 auto; }
    }
    @media print {
      @page { size: 80mm auto; margin: 0 !important; }
      html, body {
        width: 80mm !important;
        min-width: 80mm !important;
        max-width: 80mm !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: #fff !important;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt {
        width: 80mm !important;
        max-width: 80mm !important;
        margin: 0 !important;
        padding: 3mm 2.5mm !important;
      }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <!-- Store header -->
    <div class="center">
      <p class="store">${escapeHtml(options.storeName || "Store")}</p>
      <div class="meta">
        ${
          options.storeAddress
            ? `<div>${escapeHtml(options.storeAddress)}</div>`
            : ""
        }
        ${
          options.storePhone
            ? `<div>Phone: ${escapeHtml(options.storePhone)}</div>`
            : ""
        }
        ${
          options.storeEmail
            ? `<div>${escapeHtml(options.storeEmail)}</div>`
            : ""
        }
        ${
          // Which counter sold this. The receipt is the only record the customer
          // leaves with, and a return has to be traced back to the branch whose
          // stock the units actually came off. Omitted on a register selling
          // from shared stock, where naming one would be a guess.
          receipt.locationName
            ? `<div>Counter: ${escapeHtml(receipt.locationName)}</div>`
            : ""
        }
      </div>
    </div>
    <div class="dash"></div>

    <!-- Order info -->
    <div class="info">
      <div class="line"><span class="lbl">Order #</span><span class="val">${escapeHtml(receipt.orderNumber)}</span></div>
      <div class="line"><span class="lbl">Date</span><span class="val">${escapeHtml(dateText)}</span></div>
      <div class="line"><span class="lbl">Payment</span><span class="val">${escapeHtml(paymentLabel)}</span></div>
    </div>
    <div class="dash"></div>

    <!-- Items -->
    <table class="items">
      <thead>
        <tr>
          <th class="qty">Qty</th>
          <th>Item</th>
          <th class="money">Price</th>
          <th class="money">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <!-- Totals -->
    <div class="totals">
      <div class="r"><span>Sub Total</span><span>${fp(receipt.subtotal)}</span></div>
      ${
        receipt.discount > 0
          ? `<div class="r"><span>Discount</span><span>-${fp(receipt.discount)}</span></div>`
          : ""
      }
      ${taxRow}
      ${
        // Each tender on a split sale; a single tender reads as before.
        (receipt.payments ?? []).length > 1
          ? (receipt.payments ?? [])
              .map(
                (payment) =>
                  `<div class="r"><span>${escapeHtml(payment.label)}</span><span>${fp(payment.amount)}</span></div>`,
              )
              .join("")
          : ""
      }
      ${
        receipt.cashTendered !== undefined
          ? `<div class="r"><span>Cash Tendered</span><span>${fp(receipt.cashTendered)}</span></div>`
          : ""
      }
      ${
        receipt.balanceReturned > 0
          ? `<div class="r"><span>Balance Returned</span><span>${fp(receipt.balanceReturned)}</span></div>`
          : ""
      }
      <div class="r grand"><span>TOTAL</span><span>${fp(receipt.total)}</span></div>
      ${
        receipt.balanceDue && receipt.balanceDue > 0
          ? `<div class="r grand"><span>BALANCE DUE</span><span>${fp(receipt.balanceDue)}</span></div>`
          : ""
      }
    </div>

    <div class="dash"></div>

    <!-- Barcode -->
    <div class="barcode-wrap center">${barcodeSVG}</div>

    <!-- Thank you message -->
    <p class="thanks">Thank you for your visit!</p>
    <p class="footer-note">Please come again</p>

    <!-- QR code -->
    <div class="qr-wrap">
      <img src="${qrSrc}" alt="QR code for order ${escapeHtml(receipt.orderNumber)}" />
      <p class="scan-text">Scan to view digital receipt</p>
    </div>
  </div>
</body>
</html>`;
}
