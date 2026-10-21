import { useMemo } from "react";
import { barcodeValue, renderBarcode } from "@/lib/invoice-templates/barcode";
import { qrValue, renderQr } from "@/lib/invoice-templates/qr";
import type { ElementStyle, TemplateLocale } from "@/lib/invoice-templates/types";
import { pxToMm } from "@/lib/invoice-templates/units";
import { useRenderer } from "../render-context";
import type { ElementRenderProps } from "../types";

/** What the box says on screen for each reason a code can't be drawn, in the template's language (the Review tab gives the longer wording). */
const ISSUE_TEXT: Record<TemplateLocale, Record<string, string>> = {
  en: {
    empty: "No value to encode",
    invalid: "This value can't be encoded",
    formatNotAllowed: "This format isn't allowed for this source",
    renderFailed: "This code can't be drawn",
  },
  bn: {
    empty: "এনকোড করার মান নেই",
    invalid: "এই মান এনকোড করা যায় না",
    formatNotAllowed: "এই উৎসে এই ফরম্যাট চলে না",
    renderFailed: "কোডটি আঁকা যাচ্ছে না",
  },
};

/** On screen, a problem is shown in the box; on paper nothing prints. */
function Issue({ code, locale }: { code: string; locale: TemplateLocale }) {
  const { mode } = useRenderer();
  if (mode === "print") return null;
  const words = ISSUE_TEXT[locale];
  return (
    <div className="it-issue" data-code-issue={code} style={{ fontSize: "9px", color: "#b91c1c", lineHeight: 1.2, padding: "1mm" }}>
      ⚠ {words[code] ?? words.renderFailed}
    </div>
  );
}

function innerBox(props: Pick<ElementRenderProps<"barcode" | "qr">, "placed"> & { element: { style: ElementStyle } }) {
  const chrome = 2 * (props.element.style.paddingMm + pxToMm(props.element.style.borderWidthPx));
  return { widthMm: Math.max(1, props.placed.widthMm - chrome), heightMm: Math.max(1, props.placed.heightMm - chrome) };
}

/** A Code 128 / EAN-13 / UPC-A barcode of the order number, tracking number or fixed text (D-12). */
export function BarcodeElement(props: ElementRenderProps<"barcode">) {
  const { element, context } = props;
  const box = innerBox(props);
  const value = barcodeValue(element.config, context);
  const result = useMemo(
    () => renderBarcode(element.config, value, box),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element.config, value, box.widthMm, box.heightMm],
  );
  if (!result.ok) return <Issue code={result.error.code} locale={props.design.locale} />;
  return (
    <div
      className="it-barcode"
      data-value={result.value}
      data-module-mm={result.moduleWidthMm.toFixed(3)}
      style={{ width: "100%", height: "100%", lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}

/** A QR code of the tracking link, the order's tracking page, the store site or a fixed URL. */
export function QrElement(props: ElementRenderProps<"qr">) {
  const { element, context } = props;
  const box = innerBox(props);
  const value = qrValue(element.config, context);
  const result = useMemo(
    () => renderQr(element.config, value, box),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element.config, value, box.widthMm, box.heightMm],
  );
  if (!result.ok) return <Issue code={result.error.code} locale={props.design.locale} />;
  const side = Math.min(box.widthMm, box.heightMm);
  return (
    <div
      className="it-qr"
      data-value={result.value}
      style={{ width: `${side}mm`, height: `${side}mm`, lineHeight: 0, margin: element.style.textAlign === "center" ? "0 auto" : element.style.textAlign === "right" ? "0 0 0 auto" : undefined }}
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
