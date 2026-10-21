"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2, LogOut, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";

/** Who is working the till, as the terminal keeps it. */
export interface POSOperator {
  id: string;
  name: string;
  /** A colleague switched in over the signed-in account. */
  switched: boolean;
  canApplyDiscounts: boolean;
}

interface OperatorState {
  operator: { id: string; name: string; switched: boolean };
  sessionUser: { id: string; name: string };
  canApplyDiscounts: boolean;
  operators: Array<{ id: string; name: string }>;
  hasPin: boolean;
}

interface POSOperatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOffline: boolean;
  onSwitched: (operator: POSOperator) => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 8);

/**
 * Hand the till to a colleague: pick their name, type their PIN. Or hand it
 * back to the signed-in account, or set your own PIN. All of it needs the
 * server (lib/pos/operator.ts), so none of it is offered offline.
 */
export function POSOperatorDialog({ open, onOpenChange, isOffline, onSwitched }: POSOperatorDialogProps) {
  const t = useTranslations("pos.operator");
  const [state, setState] = React.useState<OperatorState | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [pin, setPin] = React.useState("");
  const [newPin, setNewPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [settingPin, setSettingPin] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setState(null);
      setLoadError(null);
      setChosen(null);
      setPin("");
      setNewPin("");
      setConfirmPin("");
      setSettingPin(false);
    }
  }

  React.useEffect(() => {
    if (!open || isOffline) return;
    const controller = new AbortController();
    fetch("/api/pos/operator", { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.message || t("loadFailed"));
        setState(json.data as OperatorState);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : t("loadFailed"));
      });
    return () => controller.abort();
  }, [open, isOffline, t]);

  if (!open) return null;

  const apply = (data: Omit<OperatorState, "operators" | "hasPin">) => {
    onSwitched({
      id: data.operator.id,
      name: data.operator.name,
      switched: data.operator.switched,
      canApplyDiscounts: data.canApplyDiscounts,
    });
  };

  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) throw new Error(json?.message || t("failed"));
    return json.data;
  };

  const switchTo = async () => {
    if (!chosen || pin.length < 4) return;
    setBusy(true);
    try {
      const data = await call("/api/pos/operator", {
        method: "POST",
        body: JSON.stringify({ operatorId: chosen, pin }),
      });
      apply(data);
      toast.success(t("switched", { name: data.operator.name }));
      onOpenChange(false);
    } catch (error) {
      setPin("");
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const switchBack = async () => {
    setBusy(true);
    try {
      const data = await call("/api/pos/operator", { method: "DELETE" });
      apply(data);
      toast.success(t("switched", { name: data.operator.name }));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const savePin = async () => {
    if (newPin !== confirmPin) {
      toast.error(t("pinMismatch"));
      return;
    }
    setBusy(true);
    try {
      await call("/api/pos/operator/pin", { method: "POST", body: JSON.stringify({ pin: newPin }) });
      toast.success(t("pinSaved"));
      setState((prev) => (prev ? { ...prev, hasPin: true } : prev));
      setSettingPin(false);
      setNewPin("");
      setConfirmPin("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const pinField = (value: string, onChange: (next: string) => void, label: string, autoFocus = false) => (
    <Input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(digitsOnly(event.target.value))}
      placeholder={label}
      aria-label={label}
      className="h-11 rounded-xl text-center text-lg tracking-[0.5em]"
      autoFocus={autoFocus}
    />
  );

  let body: React.ReactNode;
  if (isOffline) {
    body = <p className="p-5 text-sm text-muted-foreground">{t("offline")}</p>;
  } else if (loadError) {
    body = <p className="p-5 text-sm text-rose-600">{loadError}</p>;
  } else if (!state) {
    body = (
      <div className="flex justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (settingPin) {
    body = (
      <div className="space-y-3 p-5">
        <p className="text-sm text-muted-foreground">{t("pinIntro", { name: state.sessionUser.name })}</p>
        {pinField(newPin, setNewPin, t("newPin"), true)}
        {pinField(confirmPin, setConfirmPin, t("confirmPin"))}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="h-11 flex-1 rounded-xl" onClick={() => setSettingPin(false)}>
            {t("back")}
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 rounded-xl"
            disabled={busy || newPin.length < 4 || confirmPin.length < 4}
            onClick={savePin}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("savePin")}
          </Button>
        </div>
      </div>
    );
  } else {
    const others = state.operators.filter((row) => row.id !== state.operator.id);
    body = (
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-xs text-muted-foreground">{t("workingNow")}</p>
            <p className="truncate font-semibold">{state.operator.name}</p>
          </div>
          {state.operator.switched ? (
            <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={switchBack}>
              <LogOut className="mr-1 h-3.5 w-3.5" />
              {t("switchBack", { name: state.sessionUser.name })}
            </Button>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("takeOver")}</p>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("nobody")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {others.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    setChosen(row.id);
                    setPin("");
                  }}
                  aria-pressed={chosen === row.id}
                  className={cn(
                    "truncate rounded-xl border px-3 py-2 text-left text-sm",
                    chosen === row.id ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
                  )}
                >
                  {row.name}
                </button>
              ))}
            </div>
          )}
          {chosen ? (
            <div className="space-y-2 pt-1">
              {pinField(pin, setPin, t("pin"), true)}
              <Button type="button" className="h-11 w-full rounded-xl" disabled={busy || pin.length < 4} onClick={switchTo}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                {t("switch")}
              </Button>
            </div>
          ) : null}
        </div>

        {!state.operator.switched ? (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => setSettingPin(true)}
          >
            {state.hasPin ? t("changePin") : t("setPin")}
          </button>
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
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {body}
      </div>
    </div>
  );
}
