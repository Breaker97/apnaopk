"use client";

import { toast as sonnerToast, Toaster as SonnerToaster } from "sonner";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
} from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { type ReactNode } from "react";

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
    return sonnerToast(message, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
      id: options?.id,
    });
  },

  error: (message: string, options?: ToastOptions) => {
    return sonnerToast(message, {
      duration: options?.duration ?? 5000,
      icon: ToastIcons.error,
      description: options?.description,
      className: "toast-error",
      action: buildAction(options),
      id: options?.id,
    });
  },

  warning: (message: string, options?: ToastOptions) => {
    return sonnerToast(message, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.warning,
      description: options?.description,
      className: "toast-warning",
      action: buildAction(options),
      id: options?.id,
    });
  },

  info: (message: string, options?: ToastOptions) => {
    return sonnerToast(message, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.info,
      description: options?.description,
      className: "toast-info",
      action: buildAction(options),
      id: options?.id,
    });
  },

  loading: (message: string, options?: Omit<ToastOptions, "duration">) => {
    return sonnerToast(message, {
      duration: Infinity,
      icon: ToastIcons.loading,
      description: options?.description,
      className: "toast-loading",
      id: options?.id,
    });
  },

  // ── Async helpers ───────────────────────────────────────────────────────

  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: unknown) => string);
    },
  ) => {
    return sonnerToast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: messages.error,
    });
  },

  dismiss: (toastId?: string | number) => {
    sonnerToast.dismiss(toastId);
  },

  custom: (content: React.ReactElement, options?: { duration?: number }) => {
    return sonnerToast.custom(() => content, {
      duration: options?.duration ?? 4000,
    });
  },

  // ── CRUD helpers ────────────────────────────────────────────────────────

  created: (resource: string, options?: CrudToastOptions) => {
    return sonnerToast(`${resource} created successfully`, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
    });
  },

  updated: (resource: string, options?: CrudToastOptions) => {
    return sonnerToast(`${resource} updated successfully`, {
      duration: options?.duration ?? 4000,
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
    });
  },

  deleted: (resource: string, options?: CrudToastOptions) => {
    return sonnerToast(`${resource} deleted`, {
      duration: options?.undo ? 6000 : (options?.duration ?? 4000),
      icon: ToastIcons.success,
      description: options?.description,
      className: "toast-success",
      action: buildAction(options),
    });
  },

  saved: (resource?: string, options?: CrudToastOptions) => {
    const message = resource ? `${resource} saved` : "Changes saved";
    return sonnerToast(message, {
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
      return toast.success(message);
    } else {
      const message =
        options?.errorMessage ||
        response.error ||
        response.message ||
        "Something went wrong";
      return toast.error(message);
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

  return (
    <SonnerToaster
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

// Re-export for convenience
