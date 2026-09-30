"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore, type ReactNode } from "react";
import type { ExternalToast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
} from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useWhenIdle } from "@/hooks/use-idle-preload";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = "success" | "error" | "warning" | "info" | "loading";

interface ToastOptions {
  /** Optional secondary line below the main message */
  description?: string;
  /** Auto-dismiss duration in ms */
  duration?: number;
  /** Action button (e.g. Undo) */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Control toast identity for updates / deduplication */
  id?: string | number;
}

interface CrudToastOptions {
  duration?: number;
  description?: string;
  /** Show an Undo action button (primarily for delete operations) */
  undo?: () => void;
}

interface FromResponseOptions {
  /** Override success message from the API response */
  successMessage?: string;
  /** Override error message from the API response */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICON_CLASS = "size-4 shrink-0";

const ToastIcons: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 className={`${ICON_CLASS} text-emerald-500`} />,
  error: <XCircle className={`${ICON_CLASS} text-red-500`} />,
  warning: <AlertTriangle className={`${ICON_CLASS} text-amber-500`} />,
  info: <Info className={`${ICON_CLASS} text-blue-500`} />,
  loading: <Loader2 className={`${ICON_CLASS} text-primary animate-spin`} />,
};

// ---------------------------------------------------------------------------
// Sonner, on demand
// ---------------------------------------------------------------------------

// Sonner and its toaster were 35 KB of every page's first-load JavaScript, for
// a message most page views never show. The toaster mounts once the page is
// idle, or at the first toast if that comes sooner; a toast asked for before
// it listens waits for it.
type Sonner = typeof import("sonner");

const ToastHost = dynamic(
  () => import("./toast-host").then((module) => module.ToastHost),
  { ssr: false },
);

let sonner: Sonner | null = null;
let waiting: Array<(module: Sonner) => void> = [];

// Whether the toaster should be mounted: an external store the provider reads.
let toasterWanted = false;
const toasterListeners = new Set<() => void>();
function wantToaster() {
  if (toasterWanted) return;
  toasterWanted = true;
  for (const listener of toasterListeners) listener();
}
function subscribeToToaster(listener: () => void) {
  toasterListeners.add(listener);
  return () => {
    toasterListeners.delete(listener);
  };
}

function show(message: string, options: ExternalToast) {
  if (sonner) {
    sonner.toast(message, options);
    return;
  }
  waiting.push((module) => module.toast(message, options));
  wantToaster();
}

function toasterReady(module: Sonner) {
  sonner = module;
  const queued = waiting;
  waiting = [];
  for (const send of queued) send(module);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAction(options?: ToastOptions | CrudToastOptions) {
  if (!options) return undefined;

  // CrudToastOptions has `undo`
  if ("undo" in options && options.undo) {
    return { label: "Undo", onClick: options.undo };
  }

  // ToastOptions has `action`
  if ("action" in options && options.action) {
    return { label: options.action.label, onClick: options.action.onClick };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Toast API
// ---------------------------------------------------------------------------

export const toast = {
  // ── Base methods (backward-compatible) ──────────────────────────────────

  success: (message: string, options?: ToastOptions) => {
    show(message, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
      id: options?.id,
    });
  },

  error: (message: string, options?: ToastOptions) => {
    show(message, {
      duration: options?.duration ?? 5000,
      icon: ToastIcons.error,
      description: options?.description,
      className: "toast-error",
      action: buildAction(options),
      id: options?.id,
    });
  },

  warning: (message: string, options?: ToastOptions) => {
    show(message, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.warning,
      description: options?.description,
      className: "toast-warning",
      action: buildAction(options),
      id: options?.id,
    });
  },

  info: (message: string, options?: ToastOptions) => {
    show(message, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.info,
      description: options?.description,
      className: "toast-info",
      action: buildAction(options),
      id: options?.id,
    });
  },

  loading: (message: string, options?: Omit<ToastOptions, "duration">) => {
    show(message, {
      duration: Infinity,
      icon: ToastIcons.loading,
      description: options?.description,
      className: "toast-loading",
      id: options?.id,
    });
  },

  // ── CRUD helpers ────────────────────────────────────────────────────────

  created: (resource: string, options?: CrudToastOptions) => {
    show(`${resource} created successfully`, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
    });
  },

  updated: (resource: string, options?: CrudToastOptions) => {
    show(`${resource} updated successfully`, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
    });
  },

  deleted: (resource: string, options?: CrudToastOptions) => {
    show(`${resource} deleted`, {
      duration: options?.undo ? 6000 : (options?.duration ?? 4000),
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
    });
  },

  saved: (resource?: string, options?: CrudToastOptions) => {
    const message = resource ? `${resource} saved` : "Changes saved";
    show(message, {
      duration: options?.duration ?? 3000,
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
    });
  },

  // ── API response helper ─────────────────────────────────────────────────

  fromResponse: (
    response: { success: boolean; message?: string; error?: string },
    options?: FromResponseOptions,
  ) => {
    if (response.success) {
      const message =
        options?.successMessage || response.message || "Operation completed";
      toast.success(message);
    } else {
      const message =
        options?.errorMessage ||
        response.error ||
        response.message ||
        "Something went wrong";
      toast.error(message);
    }
  },
};

// ---------------------------------------------------------------------------
// Toast Provider — mount once in root layout
// ---------------------------------------------------------------------------

export function ToastProvider() {
  // Pass a concrete theme, never "system": Sonner's "system" value makes it run
  // its own `prefers-color-scheme` listener, which would render dark toasts on
  // a light page for anyone whose OS is set to dark.
  const { resolvedTheme } = useTheme();
  const wanted = useSyncExternalStore(
    subscribeToToaster,
    () => toasterWanted,
    () => false,
  );
  useWhenIdle(wanted ? null : wantToaster);

  if (!wanted) return null;

  return (
    <ToastHost
      onReady={toasterReady}
      theme={resolvedTheme}
      position="bottom-right"
      expand={false}
      closeButton
      gap={8}
      toastOptions={{
        className: "",
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
    />
  );
}
