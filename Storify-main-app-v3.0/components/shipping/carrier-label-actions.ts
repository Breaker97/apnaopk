"use client";

import {
  getSavedThermalPrinterName,
  printPdfBlobWithQz,
} from "@/lib/printing/qz-client";

/**
 * Fetching and printing a label.
 *
 * Both the carrier flow and the existing manual flow end here, so a thermal
 * printer that works for one works for the other — the label route already
 * hides which kind it is behind the same URL.
 */

export async function fetchLabelBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    // The route reports carrier faults as a JSON envelope; surface its message
    // rather than a bare status the merchant cannot act on.
    let message = "";
    try {
      const body = (await response.json()) as { message?: string };
      message = body?.message || "";
    } catch {
      message = "";
    }
    throw new Error(message || "Could not download the shipping label");
  }
  return response.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function printLabelBlob(blob: Blob) {
  await printPdfBlobWithQz(getSavedThermalPrinterName(), blob, {
    widthIn: 4,
    heightIn: 6,
  });
}
