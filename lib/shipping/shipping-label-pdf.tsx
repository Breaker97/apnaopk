import React from "react";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import sharp from "sharp";
import { renderBarcodeSvg } from "@/lib/barcode/render";
import { formatCurrency } from "@/lib/intl/money";

interface ShippingLabelAddress {
  name: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

interface ShippingLabelData {
  orderNumber: string;
  carrier: string;
  service?: string;
  trackingNumber: string;
  from: ShippingLabelAddress;
  to: ShippingLabelAddress;
  items: Array<{ name: string; sku?: string; quantity: number }>;
  parcel?: {
    weight?: number;
    weightUnit?: string;
  };
  internalLabel?: boolean;
  /**
   * Cash the courier collects at the door — `cashOnDeliveryDue` in
   * lib/shipping/carriers/build-request.ts, the figure a carrier booking sends.
   * Absent on a prepaid parcel.
   */
  cashOnDelivery?: { amount: number; currency: string };
}

const styles = StyleSheet.create({
  page: {
    width: 288,
    height: 432,
    padding: 12,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#000",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#000",
    paddingBottom: 8,
  },
  carrier: { fontSize: 18, fontWeight: 700, maxWidth: 175 },
  service: { fontSize: 9, marginTop: 2 },
  order: { fontSize: 9, textAlign: "right" },
  addressRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#000" },
  from: { width: "45%", padding: 8, borderRightWidth: 1, borderRightColor: "#000" },
  to: { width: "55%", padding: 8 },
  label: { fontSize: 7, fontWeight: 700, marginBottom: 3 },
  name: { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  addressLine: { fontSize: 9, lineHeight: 1.3 },
  cod: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#000",
  },
  codLabel: { fontSize: 9, fontWeight: 700, color: "#fff" },
  codAmount: { fontSize: 14, fontWeight: 700, color: "#fff" },
  tracking: { alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#000" },
  trackingText: { fontSize: 12, fontWeight: 700, letterSpacing: 1.2, marginTop: 3 },
  barcode: { width: 250, height: 62, objectFit: "contain" },
  contents: { paddingTop: 8, flexGrow: 1 },
  contentTitle: { fontSize: 8, fontWeight: 700, marginBottom: 4 },
  itemRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  itemName: { width: "78%", fontSize: 8 },
  itemQty: { width: "20%", textAlign: "right", fontSize: 8 },
  footer: { borderTopWidth: 1, borderTopColor: "#000", paddingTop: 5, flexDirection: "row", justifyContent: "space-between" },
  warning: { fontSize: 6.5, fontWeight: 700 },
  parcel: { fontSize: 7, textAlign: "right" },
});

function AddressBlock({
  label,
  address,
}: {
  label: string;
  address: ShippingLabelAddress;
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.name}>{address.name}</Text>
      <Text style={styles.addressLine}>{address.street}</Text>
      {address.apartment ? <Text style={styles.addressLine}>{address.apartment}</Text> : null}
      <Text style={styles.addressLine}>
        {address.city}, {address.state} {address.postalCode}
      </Text>
      <Text style={styles.addressLine}>{address.country}</Text>
      {address.phone ? <Text style={styles.addressLine}>Tel: {address.phone}</Text> : null}
    </>
  );
}

function ShippingLabelDocument({
  data,
  barcodeDataUrl,
}: {
  data: ShippingLabelData;
  barcodeDataUrl: string;
}) {
  return (
    <Document>
      <Page size={[288, 432]} style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.carrier}>{data.carrier}</Text>
            {data.service ? <Text style={styles.service}>{data.service}</Text> : null}
          </View>
          <Text style={styles.order}>ORDER{"\n"}{data.orderNumber}</Text>
        </View>
        <View style={styles.addressRow}>
          <View style={styles.from}><AddressBlock label="FROM" address={data.from} /></View>
          <View style={styles.to}><AddressBlock label="SHIP TO" address={data.to} /></View>
        </View>
        {data.cashOnDelivery ? (
          <View style={styles.cod}>
            <Text style={styles.codLabel}>CASH ON DELIVERY — COLLECT</Text>
            {/* The ISO code, not the symbol: the label's built-in Helvetica
                has no glyph for ৳, ₹ or ₦, and a courier reading a blank
                box would not know what to collect. */}
            <Text style={styles.codAmount}>
              {formatCurrency(
                data.cashOnDelivery.amount,
                data.cashOnDelivery.currency,
                "en-US",
                { currencyDisplay: "code" },
              )}
            </Text>
          </View>
        ) : null}
        <View style={styles.tracking}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image has no alt prop */}
          <Image src={barcodeDataUrl} style={styles.barcode} />
          <Text style={styles.trackingText}>{data.trackingNumber}</Text>
        </View>
        <View style={styles.contents}>
          <Text style={styles.contentTitle}>PACKAGE CONTENTS</Text>
          {data.items.slice(0, 8).map((item, index) => (
            <View key={`${item.sku || item.name}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemName}>{item.name}{item.sku ? ` · ${item.sku}` : ""}</Text>
              <Text style={styles.itemQty}>Qty {item.quantity}</Text>
            </View>
          ))}
          {data.items.length > 8 ? <Text style={styles.itemName}>+ {data.items.length - 8} more lines</Text> : null}
        </View>
        <View style={styles.footer}>
          <Text style={styles.warning}>
            {data.internalLabel ? "INTERNAL SHIPPING LABEL — NOT CARRIER POSTAGE" : "CARRIER LABEL"}
          </Text>
          <Text style={styles.parcel}>
            {data.parcel?.weight ? `${data.parcel.weight} ${data.parcel.weightUnit || "kg"}` : ""}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateShippingLabelPdf(data: ShippingLabelData) {
  const barcodeSvg = renderBarcodeSvg(data.trackingNumber, {
    format: "code128",
    heightMm: 18,
    includeText: false,
    scale: 3,
    paddingMm: 3,
  });
  const barcodePng = await sharp(Buffer.from(barcodeSvg)).png().toBuffer();
  const barcodeDataUrl = `data:image/png;base64,${barcodePng.toString("base64")}`;
  return renderToBuffer(
    <ShippingLabelDocument data={data} barcodeDataUrl={barcodeDataUrl} />,
  );
}

