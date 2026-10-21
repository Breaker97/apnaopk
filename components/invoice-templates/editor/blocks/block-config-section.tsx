"use client";

/**
 * The `config` section: the settings of whichever block the element is
 * (§5.7). One component per block type, picked by the element's type; a type
 * without settings (text, box) never reaches here because the capability map
 * gives it no `config` section.
 */
import type { TemplateElement, TemplateElementOf } from "@/lib/invoice-templates/types";
import { BusinessHeaderConfig, CustomerAddressConfig, DeliveryMethodConfig, OrderSummaryConfig } from "./field-blocks";
import { BarcodeConfigPanel, QrConfigPanel } from "./code-config";
import { ImageConfig } from "./image-config";
import { PriceSummaryConfig } from "./price-summary-config";
import { ProductRowsConfig, ProductTableConfig } from "./product-config";
import { CodBadgeConfig, LineConfig, NotesConfig } from "./simple-blocks";

export function BlockConfigSection({ element }: { element: TemplateElement }) {
  switch (element.type) {
    case "businessHeader":
      return <BusinessHeaderConfig element={element as TemplateElementOf<"businessHeader">} />;
    case "customerAddress":
      return <CustomerAddressConfig element={element as TemplateElementOf<"customerAddress">} />;
    case "orderSummary":
      return <OrderSummaryConfig element={element as TemplateElementOf<"orderSummary">} />;
    case "deliveryMethod":
      return <DeliveryMethodConfig element={element as TemplateElementOf<"deliveryMethod">} />;
    case "productTable":
      return <ProductTableConfig element={element as TemplateElementOf<"productTable">} />;
    case "productRows":
      return <ProductRowsConfig element={element as TemplateElementOf<"productRows">} />;
    case "priceSummary":
      return <PriceSummaryConfig element={element as TemplateElementOf<"priceSummary">} />;
    case "barcode":
      return <BarcodeConfigPanel element={element as TemplateElementOf<"barcode">} />;
    case "qr":
      return <QrConfigPanel element={element as TemplateElementOf<"qr">} />;
    case "image":
      return <ImageConfig element={element as TemplateElementOf<"image">} />;
    case "codBadge":
      return <CodBadgeConfig element={element as TemplateElementOf<"codBadge">} />;
    case "notes":
      return <NotesConfig element={element as TemplateElementOf<"notes">} />;
    case "line":
      return <LineConfig element={element as TemplateElementOf<"line">} />;
    default:
      return null;
  }
}
