const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const CODE_SEPARATORS = /[\s-]+/g;

export function cleanScannedCode(value: unknown): string {
  return typeof value === "string" ? value.replace(CONTROL_CHARS, "").trim() : "";
}

export function normalizeLookupCode(value: unknown): string {
  const cleaned = cleanScannedCode(value)
    .replace(CODE_SEPARATORS, "")
    .toUpperCase();

  // UPC-A scanners may emit the EAN-13 representation with a leading zero.
  if (/^0\d{12}$/.test(cleaned)) {
    return cleaned.slice(1);
  }

  return cleaned;
}

export function normalizeBarcodeForLookup(value: unknown): string {
  return normalizeLookupCode(value);
}

export function normalizeSkuForLookup(value: unknown): string {
  return normalizeLookupCode(value);
}
