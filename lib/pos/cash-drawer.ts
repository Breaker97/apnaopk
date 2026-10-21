"use client";

import { findQzPrinters, printRawWithQz } from "@/lib/printing/qz-client";

/**
 * The cash drawer.
 *
 * A till drawer hangs off the receipt printer's drawer port and opens on an
 * ESC/POS pulse (`ESC p m t1 t2`) sent to that printer. The browser cannot
 * talk to a printer port, so the pulse goes through QZ Tray as a raw job — the
 * same bridge the label studio prints through.
 *
 * Which printer, and which of its two drawer pins, is a fact about THIS
 * device, so it is kept on the device. Whether the till kicks the drawer at
 * all is the store's switch (Settings → POS → Receipts). Every byte of the
 * pulse is below 0x80, so it travels unchanged whatever encoding QZ uses.
 */

const DEVICE_KEY = "pos:cash-drawer";

export interface CashDrawerDevice {
  printerName: string;
  /** The drawer connector pin: 2 on most printers, 5 on some. */
  pin: 2 | 5;
}

export function readCashDrawerDevice(): CashDrawerDevice | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CashDrawerDevice>;
    const printerName = String(parsed.printerName || "").trim();
    if (!printerName) return null;
    return { printerName, pin: parsed.pin === 5 ? 5 : 2 };
  } catch {
    return null;
  }
}

export function saveCashDrawerDevice(device: CashDrawerDevice | null): void {
  try {
    if (device && device.printerName.trim()) {
      window.localStorage.setItem(DEVICE_KEY, JSON.stringify({ printerName: device.printerName.trim(), pin: device.pin }));
    } else {
      window.localStorage.removeItem(DEVICE_KEY);
    }
  } catch {
    // Storage blocked: the drawer stays shut, the till still sells.
  }
}

/** The ESC/POS pulse: pin, 50 ms on, 100 ms off. */
export function cashDrawerPulse(pin: 2 | 5): string {
  return `\x1B\x70${pin === 5 ? "\x01" : "\x00"}\x19\x32`;
}

/** The printers QZ Tray can see, to pick the drawer's from. */
export function listDrawerPrinters(): Promise<string[]> {
  return findQzPrinters();
}

/**
 * Open the drawer. Resolves false — never throws — when this device has no
 * drawer printer or QZ Tray is not running: a drawer that stays shut must
 * never stop a sale that has already been taken.
 */
export async function kickCashDrawer(device: CashDrawerDevice | null = readCashDrawerDevice()): Promise<boolean> {
  if (!device) return false;
  try {
    await printRawWithQz(device.printerName, [cashDrawerPulse(device.pin)], { jobName: "Cash drawer" });
    return true;
  } catch {
    return false;
  }
}
