"use client";

import type * as QzTray from "qz-tray";

let qzPromise: Promise<typeof QzTray> | null = null;
let securityConfigured = false;

export const THERMAL_PRINTER_PROFILE_KEY =
  "storify:thermal-printer-profile:v1";

export function getSavedThermalPrinterName() {
  if (typeof window === "undefined") return "";
  try {
    const profile = JSON.parse(
      localStorage.getItem(THERMAL_PRINTER_PROFILE_KEY) || "{}",
    ) as { printerName?: unknown };
    return typeof profile.printerName === "string"
      ? profile.printerName.trim()
      : "";
  } catch {
    return "";
  }
}

async function getQz() {
  if (!qzPromise) {
    qzPromise = import("qz-tray") as Promise<typeof QzTray>;
  }
  return qzPromise;
}

async function configureSecurity(qz: typeof QzTray) {
  if (securityConfigured) return;

  qz.security.setCertificatePromise((resolve, reject) => {
    fetch("/api/printing/qz/certificate", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        resolve(await response.text());
      })
      .catch((error) => reject(String(error)));
  });
  qz.security.setSignatureAlgorithm("SHA512");
  qz.security.setSignaturePromise(async (toSign) => {
    const response = await fetch("/api/printing/qz/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: toSign }),
    });
    if (!response.ok) throw new Error(await response.text());
    const payload = (await response.json()) as { signature?: string };
    if (!payload.signature) throw new Error("QZ signing response was empty");
    return payload.signature;
  });
  securityConfigured = true;
}

async function connectQzTray() {
  const qz = await getQz();
  await configureSecurity(qz);
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ retries: 2, delay: 1 });
  }
  return qz;
}

export async function findQzPrinters(): Promise<string[]> {
  const qz = await connectQzTray();
  const result = await qz.printers.find();
  return Array.isArray(result) ? result : result ? [result] : [];
}

export async function printRawWithQz(
  printerName: string,
  jobs: string[],
  options: { jobName?: string; encoding?: string } = {},
) {
  if (!printerName.trim()) throw new Error("Select a printer first");
  if (jobs.length === 0) throw new Error("Nothing to print");

  const qz = await connectQzTray();
  const config = qz.configs.create(printerName, {
    jobName: options.jobName || "Thermal labels",
    encoding: options.encoding || "UTF-8",
    forceRaw: true,
  });
  await qz.print(
    config,
    jobs.map((data) => ({
      type: "raw" as const,
      format: "command" as const,
      flavor: "plain" as const,
      data,
    })),
  );
}

async function printPdfBase64WithQz(
  printerName: string,
  pdfBase64: string,
  options: { widthIn?: number; heightIn?: number; copies?: number } = {},
) {
  const qz = await connectQzTray();
  const config = qz.configs.create(printerName, {
    jobName: "Shipping label",
    copies: Math.max(1, Math.trunc(options.copies ?? 1)),
    units: "in",
    size: {
      width: options.widthIn ?? 4,
      height: options.heightIn ?? 6,
    },
    margins: 0,
    scaleContent: true,
  });
  await qz.print(config, [
    {
      type: "pixel",
      format: "pdf",
      flavor: "base64",
      data: pdfBase64,
    },
  ]);
}

export async function printPdfBlobWithQz(
  printerName: string,
  pdf: Blob,
  options: { widthIn?: number; heightIn?: number; copies?: number } = {},
) {
  if (!printerName.trim()) {
    throw new Error(
      "Select and save a printer in the Inventory barcode label studio first",
    );
  }
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("Could not read the shipping label"));
      else resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read the shipping label"));
    reader.readAsDataURL(pdf);
  });
  await printPdfBase64WithQz(printerName, base64, options);
}
