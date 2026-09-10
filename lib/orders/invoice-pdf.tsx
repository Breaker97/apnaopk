/**
 * Invoice PDF Template
 * Generates a professional invoice PDF using @react-pdf/renderer
 */

import path from "node:path";
import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import { formatCurrency } from "@/lib/intl/money";

// ============================================
// Types
// ============================================

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceAddress {
  name: string;
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  status: "Paid" | "Pending" | "Overdue" | "Cancelled";
  dateCreated: string;
  dueDate: string;
  from: InvoiceAddress;
  to: InvoiceAddress;
  items: InvoiceItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  locale?: string;
  notes?: string;
  supportEmail?: string;
  logoUrl?: string;
  storeName?: string;
}

// ============================================
// Font Registration
// ============================================

// Bundled with the app (public/fonts/inter, SIL OFL) rather than fetched from
// Google Fonts on every render: an invoice must not depend on the server
// having internet, and @react-pdf reads TTF, not the woff2 the pages use.
const interFont = (weight: 400 | 500 | 600 | 700) => ({
  src: path.join(
    process.cwd(),
    "public",
    "fonts",
    "inter",
    `inter-${weight}.ttf`,
  ),
  fontWeight: weight,
});

Font.register({
  family: "Inter",
  fonts: [interFont(400), interFont(500), interFont(600), interFont(700)],
});

// ============================================
// Styles
// ============================================

const colors = {
  text: "#212B36",
  textSecondary: "#637381",
  border: "#F4F6F8",
  borderDark: "#DFE3E8",
  white: "#FFFFFF",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 10,
    color: colors.text,
    backgroundColor: colors.white,
    paddingTop: 48,
    paddingBottom: 80,
    paddingHorizontal: 48,
  },

  // ── Header: "Invoice" title + logo ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: colors.text,
  },
  logoImage: {
    maxWidth: 120,
    maxHeight: 40,
  },
  logoFallback: {
    fontSize: 16,
    fontWeight: 700,
    color: colors.text,
  },

  // ── Invoice meta (number, dates) ──
  metaSection: {
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: colors.text,
    width: 100,
  },
  metaValue: {
    fontSize: 10,
    color: colors.text,
  },

  // ── Divider ──
  divider: {
    height: 1,
    backgroundColor: colors.borderDark,
    marginVertical: 14,
  },

  // ── Address columns ──
  addressSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  addressBlock: {
    width: "48%",
  },
  addressName: {
    fontSize: 11,
    fontWeight: 600,
    color: colors.text,
    marginBottom: 4,
  },
  addressLine: {
    fontSize: 10,
    color: colors.textSecondary,
    lineHeight: 1.7,
  },
  billToLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: colors.textSecondary,
    marginBottom: 6,
  },

  // ── Items table ──
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text,
    marginBottom: 14,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderDark,
    paddingBottom: 10,
  },
  tableHeaderText: {
    fontSize: 10,
    fontWeight: 600,
    color: colors.textSecondary,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 14,
    alignItems: "flex-start",
  },
  colNumber: { width: "6%" },
  colDescription: { width: "50%" },
  colQty: { width: "12%", textAlign: "center" as const },
  colUnitPrice: { width: "16%", textAlign: "center" as const },
  colTotal: { width: "16%", textAlign: "right" as const },
  itemName: {
    fontSize: 10,
    fontWeight: 600,
    color: colors.text,
    marginBottom: 3,
  },
  itemDescription: {
    fontSize: 9,
    color: colors.textSecondary,
    lineHeight: 1.5,
  },
  cellText: { fontSize: 10, color: colors.text },

  // ── Summary ──
  summarySection: {
    marginTop: 16,
    alignItems: "flex-end",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "40%",
    paddingVertical: 5,
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    width: "50%",
    textAlign: "right" as const,
    paddingRight: 16,
  },
  summaryValue: {
    fontSize: 10,
    color: colors.text,
    width: "50%",
    textAlign: "right" as const,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    width: "40%",
    paddingVertical: 8,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: colors.text,
    width: "50%",
    textAlign: "right" as const,
    paddingRight: 16,
  },
  totalValue: {
    fontSize: 12,
    fontWeight: 700,
    color: colors.text,
    width: "50%",
    textAlign: "right" as const,
  },

  // ── Footer ──
  footer: {
    position: "absolute",
    bottom: 30,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
  },
  footerLeft: { width: "60%" },
  footerRight: { width: "40%", alignItems: "flex-end" },
  footerLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: colors.text,
    marginBottom: 4,
  },
  footerText: {
    fontSize: 9,
    color: colors.textSecondary,
    lineHeight: 1.5,
  },
});

// ============================================
// Helper: format an address block into lines
// ============================================

function AddressLines({ addr }: { addr: InvoiceAddress }) {
  const parts: string[] = [];
  if (addr.street) parts.push(addr.street);

  const cityLine = [addr.city, addr.state].filter(Boolean).join(", ");
  const cityPostal = [cityLine, addr.postalCode].filter(Boolean).join(" - ");
  if (cityPostal) parts.push(cityPostal);

  if (addr.country) parts.push(addr.country);
  if (addr.phone) parts.push(addr.phone);
  if (addr.email) parts.push(addr.email);

  return (
    <>
      {parts.map((line, i) => (
        <Text key={i} style={styles.addressLine}>
          {line}
        </Text>
      ))}
    </>
  );
}

// ============================================
// Invoice Document Component
// ============================================

function InvoiceDocument({
  data,
  logoDataUri,
}: {
  data: InvoiceData;
  logoDataUri?: string;
}) {
  const fmt = (amount: number) =>
    formatCurrency(amount, data.currency, data.locale);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Header: "Invoice" title  +  Logo ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Invoice</Text>
          <View>
            {logoDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image has no alt prop
              <Image src={logoDataUri} style={styles.logoImage} />
            ) : (
              <Text style={styles.logoFallback}>
                {data.storeName || data.from.name || ""}
              </Text>
            )}
          </View>
        </View>

        {/* ── Invoice metadata ── */}
        <View style={styles.metaSection}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Invoice number</Text>
            <Text style={styles.metaValue}>{data.invoiceNumber}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date of issue</Text>
            <Text style={styles.metaValue}>{data.dateCreated}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date due</Text>
            <Text style={styles.metaValue}>{data.dueDate}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>{data.status}</Text>
          </View>
        </View>

        {/* ── Divider ── */}
        <View style={styles.divider} />

        {/* ── From / Bill to ── */}
        <View style={styles.addressSection}>
          <View style={styles.addressBlock}>
            <Text style={styles.addressName}>{data.from.name}</Text>
            <AddressLines addr={data.from} />
          </View>
          <View style={styles.addressBlock}>
            <Text style={styles.billToLabel}>Bill to</Text>
            <Text style={styles.addressName}>{data.to.name}</Text>
            <AddressLines addr={data.to} />
          </View>
        </View>

        {/* ── Items table title ── */}
        <Text style={styles.sectionTitle}>Invoice details</Text>

        {/* ── Table header ── */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.colNumber]}>#</Text>
          <Text style={[styles.tableHeaderText, styles.colDescription]}>
            Description
          </Text>
          <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
          <Text style={[styles.tableHeaderText, styles.colUnitPrice]}>
            Unit price
          </Text>
          <Text style={[styles.tableHeaderText, styles.colTotal]}>Total</Text>
        </View>

        {/* ── Table rows ── */}
        {data.items.map((item, index) => (
          <View key={index} style={styles.tableRow}>
            <Text style={[styles.cellText, styles.colNumber]}>
              {index + 1}
            </Text>
            <View style={styles.colDescription}>
              <Text style={styles.itemName}>{item.name}</Text>
              {item.description && (
                <Text style={styles.itemDescription}>{item.description}</Text>
              )}
            </View>
            <Text style={[styles.cellText, styles.colQty]}>
              {item.quantity}
            </Text>
            <Text style={[styles.cellText, styles.colUnitPrice]}>
              {item.unitPrice.toFixed(2)}
            </Text>
            <Text style={[styles.cellText, styles.colTotal]}>
              {fmt(item.total)}
            </Text>
          </View>
        ))}

        {/* ── Summary ── */}
        <View style={styles.summarySection}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{fmt(data.subtotal)}</Text>
          </View>
          {data.shipping !== 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Shipping</Text>
              <Text style={styles.summaryValue}>
                {data.shipping > 0
                  ? fmt(data.shipping)
                  : `-${fmt(Math.abs(data.shipping))}`}
              </Text>
            </View>
          )}
          {data.discount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Discount</Text>
              <Text style={styles.summaryValue}>-{fmt(data.discount)}</Text>
            </View>
          )}
          {data.tax > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Taxes</Text>
              <Text style={styles.summaryValue}>{fmt(data.tax)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{fmt(data.total)}</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLabel}>NOTES</Text>
            <Text style={styles.footerText}>
              {data.notes ||
                "We appreciate your business. Should you need us to add VAT or extra notes let us know!"}
            </Text>
          </View>
          {data.supportEmail && (
            <View style={styles.footerRight}>
              <Text style={styles.footerLabel}>Have a question?</Text>
              <Text style={styles.footerText}>{data.supportEmail}</Text>
            </View>
          )}
        </View>
      </Page>
    </Document>
  );
}

// ============================================
// PDF Generation Helper
// ============================================

async function fetchLogoBuffer(
  url?: string
): Promise<{ data: Buffer; type: string } | undefined> {
  if (!url) return undefined;
  try {
    const absoluteUrl =
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}${url.startsWith("/") ? "" : "/"}${url}`;

    const res = await fetch(absoluteUrl);
    if (!res.ok) {
      console.error(
        `[invoice-pdf] Logo fetch failed: ${res.status} for ${absoluteUrl}`
      );
      return undefined;
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await res.arrayBuffer());

    console.log(
      `[invoice-pdf] Logo fetched: ${contentType}, ${buffer.length} bytes`
    );

    return { data: buffer, type: contentType };
  } catch (err) {
    console.error("[invoice-pdf] Logo fetch error:", err);
    return undefined;
  }
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const logo = await fetchLogoBuffer(data.logoUrl);

  let logoDataUri: string | undefined;
  if (logo) {
    // @react-pdf/renderer only supports PNG and JPG natively
    // For unsupported formats (webp, svg, avif), skip the logo
    const supported =
      logo.type.includes("png") ||
      logo.type.includes("jpeg") ||
      logo.type.includes("jpg");

    if (supported) {
      logoDataUri = `data:${logo.type};base64,${logo.data.toString("base64")}`;
    } else {
      console.warn(
        `[invoice-pdf] Unsupported logo format: ${logo.type}. Use PNG or JPG for invoice logo.`
      );
    }
  }

  return renderToBuffer(
    <InvoiceDocument data={data} logoDataUri={logoDataUri} />
  );
}
