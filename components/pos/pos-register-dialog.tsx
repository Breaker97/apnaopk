"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Lock,
  Printer,
  Unlock,
  Vault,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { printSlip } from "@/lib/pos/print-slip";
import {
  kickCashDrawer,
  listDrawerPrinters,
  readCashDrawerDevice,
  saveCashDrawerDevice,
  type CashDrawerDevice,
} from "@/lib/pos/cash-drawer";
import type { POSRegisterState } from "@/hooks/use-pos-register";
import type { RegisterSessionView } from "@/lib/pos/register-session-dto";

type Step = "summary" | "open" | "in" | "out" | "close" | "closed" | "nosale" | "printer";

interface POSRegisterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  register: POSRegisterState;
  fp: (amount: number) => string;
  isOffline: boolean;
  /** Sales still in the offline queue: the drawer cannot close until they sync. */
  queuedCount: number;
  storeName?: string;
  locationName?: string;
  /** The store kicks the drawer open when cash changes hands (Settings → POS). */
  openCashDrawer?: boolean;
}

const TENDER_KEYS = ["cash", "card", "bank", "manual", "store_credit"] as const;

/**
 * The drawer: open it with a float, put notes in or take them out, see what
 * it should hold (the X report), close it with a count (the Z report).
 */
export function POSRegisterDialog({
  open,
  onOpenChange,
  register,
  fp,
  isOffline,
  queuedCount,
  storeName,
  locationName,
  openCashDrawer = false,
}: POSRegisterDialogProps) {
  const t = useTranslations("pos.register");
  const format = useFormatter();
  const [step, setStep] = React.useState<Step>("summary");
  const [amount, setAmount] = React.useState<number | undefined>(undefined);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [closedView, setClosedView] = React.useState<RegisterSessionView | null>(null);
  // This device's drawer printer (lib/pos/cash-drawer.ts), read when the
  // dialog opens: localStorage is not there during the server render.
  const [drawer, setDrawer] = React.useState<CashDrawerDevice | null>(null);
  const [printers, setPrinters] = React.useState<string[] | null>(null);
  const [printerChoice, setPrinterChoice] = React.useState<CashDrawerDevice>({ printerName: "", pin: 2 });
  const [findingPrinters, setFindingPrinters] = React.useState(false);

  const details = register.details && register.details.status === "open" ? register.details : null;
  const hasOpen = Boolean(register.session);

  // Opening the dialog lands on the right first step, and fresh numbers.
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(hasOpen ? "summary" : "open");
      setAmount(undefined);
      setReason("");
      setNote("");
      setClosedView(null);
      const device = readCashDrawerDevice();
      setDrawer(device);
      setPrinterChoice(device ?? { printerName: "", pin: 2 });
      setPrinters(null);
    }
  }
  const kick = () => {
    if (openCashDrawer) void kickCashDrawer(drawer);
  };
  React.useEffect(() => {
    if (open && !isOffline) void register.refresh();
    // Refresh once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await task();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const totals = details?.totals;
  const expectedCash = totals?.expectedCash ?? 0;
  const variance = amount === undefined ? 0 : Math.round((amount - expectedCash) * 100) / 100;

  const tenderName = (key: (typeof TENDER_KEYS)[number]) => t(`tender.${key}`);

  const printReport = (view: RegisterSessionView) => {
    const closing = view.closing;
    const tenders = closing ? closing.expected : view.totals?.tenders;
    const when = (iso: string, by?: string) =>
      `${format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" })}${by ? ` · ${by}` : ""}`;
    const rows: Array<[string, string]> = [
      [t("reportOpened"), when(view.openedAt, view.openedBy)],
      ...(view.closedAt ? ([[t("reportClosed"), when(view.closedAt, view.closedBy)]] as Array<[string, string]>) : []),
      [t("openingFloat"), fp(view.openingFloat)],
      [t("salesCount"), String(closing?.salesCount ?? view.totals?.salesCount ?? 0)],
      [t("grossSales"), fp(closing?.grossSales ?? view.totals?.grossSales ?? 0)],
      ...TENDER_KEYS.filter((key) => key !== "cash" && (tenders?.[key] ?? 0) > 0).map(
        (key) => [tenderName(key), fp(tenders?.[key] ?? 0)] as [string, string],
      ),
      [
        t("cashSales"),
        fp(
          closing
            ? closing.expected.cash - view.openingFloat - closing.cashIn + closing.cashOut + closing.refunds
            : (view.totals?.tenders.cash ?? 0),
        ),
      ],
      [t("cashIn"), fp(closing?.cashIn ?? view.totals?.cashIn ?? 0)],
      [t("cashOut"), fp(closing?.cashOut ?? view.totals?.cashOut ?? 0)],
      [t("cashRefunds"), fp(closing?.refunds ?? view.totals?.refunds ?? 0)],
      [t("expectedCash"), fp(closing?.expected.cash ?? view.totals?.expectedCash ?? 0)],
      ...(closing
        ? ([
            [t("countedCash"), fp(closing.counted.cash)],
            [t("variance"), fp(closing.variance)],
          ] as Array<[string, string]>)
        : []),
    ];
    const printed = printSlip({
      title: closing ? t("zReport") : t("xReport"),
      heading: [storeName, locationName, view.number],
      rows,
      footer: closing?.note,
    });
    if (!printed) toast.error(t("printBlocked"));
  };

  const header = (
    <div className="flex items-center justify-between border-b px-5 py-3.5">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Vault className="h-4 w-4" />
        {details?.number ?? register.session?.number ?? t("title")}
      </h2>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={() => onOpenChange(false)}
        aria-label={t("close")}
        disabled={busy}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );

  const row = (label: string, value: string, strong = false) => (
    <div className={cn("flex justify-between gap-3 text-sm", strong && "font-semibold")}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  const offlineNote = isOffline ? (
    <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{t("offline")}</p>
  ) : null;

  let body: React.ReactNode = null;
  if (step === "open") {
    body = (
      <div className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">{t("openIntro")}</p>
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="pos-float">
            {t("openingFloat")}
          </label>
          <NumberInput
            id="pos-float"
            min={0}
            step={0.01}
            value={amount ?? 0}
            whenEmpty={0}
            onValueChange={(next) => setAmount(next)}
            className="h-11 rounded-xl text-base tabular-nums"
            autoFocus
          />
        </div>
        {offlineNote}
        <Button
          type="button"
          className="h-11 w-full rounded-xl"
          disabled={busy || isOffline}
          onClick={async () => {
            if (await run(() => register.open(amount ?? 0), t("opened"))) setStep("summary");
          }}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlock className="mr-2 h-4 w-4" />}
          {t("openRegister")}
        </Button>
      </div>
    );
  } else if (step === "in" || step === "out") {
    body = (
      <div className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">{step === "in" ? t("cashInIntro") : t("cashOutIntro")}</p>
        <NumberInput
          aria-label={t("amount")}
          min={0}
          step={0.01}
          value={amount ?? 0}
          whenEmpty={0}
          onValueChange={(next) => setAmount(next)}
          className="h-11 rounded-xl text-base tabular-nums"
          autoFocus
        />
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("reasonPlaceholder")}
          aria-label={t("reason")}
          className="h-11 rounded-xl"
          maxLength={300}
        />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="h-11 flex-1 rounded-xl" onClick={() => setStep("summary")}>
            {t("back")}
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 rounded-xl"
            disabled={busy || isOffline || !(amount && amount > 0) || !reason.trim()}
            onClick={async () => {
              const kind = step;
              if (await run(() => register.moveCash(kind, amount ?? 0, reason.trim()), kind === "in" ? t("cashAdded") : t("cashRemoved"))) {
                kick();
                setAmount(undefined);
                setReason("");
                setStep("summary");
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {step === "in" ? t("cashIn") : t("cashOut")}
          </Button>
        </div>
      </div>
    );
  } else if (step === "nosale") {
    body = (
      <div className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">{t("noSaleIntro")}</p>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("reasonPlaceholder")}
          aria-label={t("reason")}
          className="h-11 rounded-xl"
          maxLength={300}
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="h-11 flex-1 rounded-xl" onClick={() => setStep("summary")}>
            {t("back")}
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 rounded-xl"
            disabled={busy || isOffline || !reason.trim()}
            onClick={async () => {
              if (await run(() => register.moveCash("no_sale", 0, reason.trim()), t("noSaleDone"))) {
                kick();
                setReason("");
                setStep("summary");
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlock className="mr-2 h-4 w-4" />}
            {t("noSale")}
          </Button>
        </div>
      </div>
    );
  } else if (step === "printer") {
    body = (
      <div className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">{t("printerIntro")}</p>
        {printers === null ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-xl"
            disabled={findingPrinters}
            onClick={async () => {
              setFindingPrinters(true);
              try {
                setPrinters(await listDrawerPrinters());
              } catch {
                toast.error(t("printerQzMissing"));
              } finally {
                setFindingPrinters(false);
              }
            }}
          >
            {findingPrinters ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            {t("printerFind")}
          </Button>
        ) : (
          <select
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
            value={printerChoice.printerName}
            onChange={(event) => setPrinterChoice((prev) => ({ ...prev, printerName: event.target.value }))}
            aria-label={t("printer")}
          >
            <option value="">{t("printerNone")}</option>
            {printers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("printerPin")}</span>
          {([2, 5] as const).map((pin) => (
            <button
              key={pin}
              type="button"
              aria-pressed={printerChoice.pin === pin}
              onClick={() => setPrinterChoice((prev) => ({ ...prev, pin }))}
              className={cn(
                "rounded-lg border px-3 py-1.5",
                printerChoice.pin === pin ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
              )}
            >
              {pin}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            disabled={!printerChoice.printerName}
            onClick={async () => {
              if (!(await kickCashDrawer(printerChoice))) toast.error(t("printerTestFailed"));
            }}
          >
            {t("printerTest")}
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl"
            onClick={() => {
              const device = printerChoice.printerName ? printerChoice : null;
              saveCashDrawerDevice(device);
              setDrawer(device);
              toast.success(t("printerSaved"));
              setStep(hasOpen ? "summary" : "open");
            }}
          >
            {t("printerSave")}
          </Button>
        </div>
      </div>
    );
  } else if (step === "close") {
    body = (
      <div className="space-y-4 p-5">
        {row(t("expectedCash"), fp(expectedCash), true)}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="pos-counted">
            {t("countedCash")}
          </label>
          <NumberInput
            id="pos-counted"
            min={0}
            step={0.01}
            value={amount ?? 0}
            whenEmpty={0}
            onValueChange={(next) => setAmount(next)}
            className="h-11 rounded-xl text-base tabular-nums"
            autoFocus
          />
        </div>
        {amount !== undefined ? (
          <div
            className={cn(
              "flex justify-between rounded-xl px-4 py-3 text-sm font-semibold",
              variance === 0
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
            )}
          >
            <span>{variance === 0 ? t("balanced") : variance > 0 ? t("over") : t("short")}</span>
            <span className="tabular-nums">{fp(variance)}</span>
          </div>
        ) : null}
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t("notePlaceholder")}
          aria-label={t("note")}
          className="h-11 rounded-xl"
          maxLength={1000}
        />
        {queuedCount > 0 ? (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {t("queuedFirst", { count: queuedCount })}
          </p>
        ) : null}
        {offlineNote}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="h-11 flex-1 rounded-xl" onClick={() => setStep("summary")}>
            {t("back")}
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 rounded-xl"
            disabled={busy || isOffline || queuedCount > 0 || amount === undefined}
            onClick={async () => {
              let view: RegisterSessionView | null = null;
              if (
                await run(async () => {
                  view = await register.close(amount ?? 0, note.trim() || undefined);
                }, t("closed"))
              ) {
                setClosedView(view);
                setStep("closed");
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
            {t("closeRegister")}
          </Button>
        </div>
      </div>
    );
  } else if (step === "closed" && closedView?.closing) {
    const closing = closedView.closing;
    body = (
      <div className="space-y-3 p-5">
        <p className="text-sm font-semibold">{t("zReport")}</p>
        {row(t("salesCount"), String(closing.salesCount))}
        {row(t("grossSales"), fp(closing.grossSales))}
        {row(t("expectedCash"), fp(closing.expected.cash))}
        {row(t("countedCash"), fp(closing.counted.cash))}
        {row(closing.variance === 0 ? t("balanced") : closing.variance > 0 ? t("over") : t("short"), fp(closing.variance), true)}
        <Button type="button" variant="outline" className="h-11 w-full rounded-xl" onClick={() => printReport(closedView)}>
          <Printer className="mr-2 h-4 w-4" />
          {t("printZ")}
        </Button>
      </div>
    );
  } else {
    // Summary: the X report and the actions.
    const session = details ?? register.session;
    body = (
      <div className="space-y-4 p-5">
        {session ? (
          <p className="text-xs text-muted-foreground">
            {t("openedAt", {
              time: format.dateTime(new Date(session.openedAt), { dateStyle: "medium", timeStyle: "short" }),
            })}
            {details?.openedBy ? ` · ${details.openedBy}` : ""}
          </p>
        ) : null}
        {totals ? (
          <div className="space-y-1.5 rounded-xl border p-3">
            {row(t("openingFloat"), fp(details?.openingFloat ?? 0))}
            {row(t("salesCount"), String(totals.salesCount))}
            {row(t("grossSales"), fp(totals.grossSales))}
            {TENDER_KEYS.filter((key) => totals.tenders[key] > 0).map((key) => (
              <React.Fragment key={key}>{row(tenderName(key), fp(totals.tenders[key]))}</React.Fragment>
            ))}
            {totals.cashIn > 0 ? row(t("cashIn"), fp(totals.cashIn)) : null}
            {totals.cashOut > 0 ? row(t("cashOut"), `−${fp(totals.cashOut)}`) : null}
            {totals.refunds > 0 ? row(t("cashRefunds"), `−${fp(totals.refunds)}`) : null}
            <div className="border-t pt-1.5">{row(t("expectedCash"), fp(totals.expectedCash), true)}</div>
          </div>
        ) : register.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {offlineNote}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            disabled={isOffline}
            onClick={() => {
              setAmount(undefined);
              setStep("in");
            }}
          >
            <ArrowDownToLine className="mr-1.5 h-4 w-4" />
            {t("cashIn")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            disabled={isOffline}
            onClick={() => {
              setAmount(undefined);
              setStep("out");
            }}
          >
            <ArrowUpFromLine className="mr-1.5 h-4 w-4" />
            {t("cashOut")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            disabled={!details}
            onClick={() => details && printReport(details)}
          >
            <Printer className="mr-1.5 h-4 w-4" />
            {t("printX")}
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl"
            disabled={isOffline}
            onClick={() => {
              setAmount(undefined);
              setStep("close");
            }}
          >
            <Lock className="mr-1.5 h-4 w-4" />
            {t("closeRegister")}
          </Button>
        </div>
        {openCashDrawer ? (
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
            <button
              type="button"
              className="font-medium text-primary hover:underline disabled:opacity-50"
              disabled={isOffline || !drawer}
              title={!drawer ? t("printerNotSet") : undefined}
              onClick={() => {
                setReason("");
                setStep("nosale");
              }}
            >
              {t("noSale")}
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setStep("printer")}
            >
              {drawer ? t("printerCurrent", { name: drawer.printerName }) : t("printerSetUp")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className="w-full max-w-md overflow-hidden rounded-2xl border bg-background shadow-2xl"
      >
        {header}
        {body}
      </div>
    </div>
  );
}
