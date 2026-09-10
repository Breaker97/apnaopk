

export type BarcodeFormat = "ean13" | "upca" | "gtin14" | "code128";
export type BarcodeSource = "manufacturer" | "gs1" | "internal";

interface BarcodeInspection {
  value: string;
  format: BarcodeFormat;
  valid: boolean;
  marketplaceEligible: boolean;
  restrictedCirculation: boolean;
  message?: string;
}

const ASCII_PRINTABLE = /^[\x20-\x7e]+$/;

function cleanBarcodeValue(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
    : "";
}

function stripBarcodeFormatting(value: unknown): string {
  return cleanBarcodeValue(value).replace(/[\s-]+/g, "");
}

export function calculateGtinCheckDigit(payload: string): string {
  if (!/^\d+$/.test(payload)) {
    throw new Error("GTIN payload must contain digits only");
  }

  let sum = 0;
  let weight = 3;
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    sum += Number(payload[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }

  return String((10 - (sum % 10)) % 10);
}

export function hasValidGtinCheckDigit(value: string): boolean {
  return (
    /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(value) &&
    calculateGtinCheckDigit(value.slice(0, -1)) === value.slice(-1)
  );
}

export function detectBarcodeFormat(
  value: unknown,
  preferred?: BarcodeFormat,
): BarcodeFormat {
  const normalized = stripBarcodeFormatting(value);
  if (preferred) return preferred;
  if (/^\d{12}$/.test(normalized)) return "upca";
  if (/^\d{13}$/.test(normalized)) return "ean13";
  if (/^\d{14}$/.test(normalized)) return "gtin14";
  return "code128";
}

function isRestrictedCirculationGtin(value: unknown): boolean {
  const normalized = stripBarcodeFormatting(value);
  const gtin13 = normalized.length === 14 && normalized.startsWith("0")
    ? normalized.slice(1)
    : normalized;
  return /^0?2\d/.test(gtin13) || /^(2[0-9])/.test(gtin13);
}

export function inspectBarcode(
  value: unknown,
  options: { format?: BarcodeFormat; source?: BarcodeSource } = {},
): BarcodeInspection {
  const cleaned = cleanBarcodeValue(value);
  const format = detectBarcodeFormat(cleaned, options.format);
  const normalized = format === "code128" ? cleaned : stripBarcodeFormatting(cleaned);
  const restrictedCirculation =
    (format === "ean13" || format === "gtin14") &&
    isRestrictedCirculationGtin(normalized);

  if (!normalized) {
    return {
      value: normalized,
      format,
      valid: false,
      marketplaceEligible: false,
      restrictedCirculation,
      message: "Barcode is required",
    };
  }

  if (format === "code128") {
    const valid = normalized.length <= 80 && ASCII_PRINTABLE.test(normalized);
    return {
      value: normalized,
      format,
      valid,
      marketplaceEligible: false,
      restrictedCirculation: false,
      message: valid
        ? undefined
        : "Code 128 must contain 1-80 printable ASCII characters",
    };
  }

  const expectedLength = format === "upca" ? 12 : format === "ean13" ? 13 : 14;
  if (!new RegExp(`^\\d{${expectedLength}}$`).test(normalized)) {
    return {
      value: normalized,
      format,
      valid: false,
      marketplaceEligible: false,
      restrictedCirculation,
      message: `${format.toUpperCase()} must contain ${expectedLength} digits`,
    };
  }

  const valid = hasValidGtinCheckDigit(normalized);
  const issuedExternally = options.source === "manufacturer" || options.source === "gs1";
  return {
    value: normalized,
    format,
    valid,
    marketplaceEligible: valid && issuedExternally && !restrictedCirculation,
    restrictedCirculation,
    message: valid
      ? restrictedCirculation
        ? "Restricted-circulation GTIN: use inside this business only"
        : undefined
      : "Invalid GTIN check digit",
  };
}

/**
 * Creates an EAN-13 Restricted Circulation Number for use inside one merchant.
 * Prefix 20 is intentionally never represented as a marketplace/GS1-issued GTIN.
 */
export function generateInternalEan13(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  const body = `${words[0] % 100_000}`.padStart(5, "0") +
    `${words[1] % 100_000}`.padStart(5, "0");
  const payload = `20${body}`;
  return `${payload}${calculateGtinCheckDigit(payload)}`;
}
