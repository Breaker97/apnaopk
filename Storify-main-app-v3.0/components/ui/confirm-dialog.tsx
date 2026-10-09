"use client";

import type { ReactNode } from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Trash2,
  Info,
  HelpCircle,
  Loader2,
  X,
} from "lucide-react";

/**
 * Confirmation Dialog Types
 */
type ConfirmationType = "danger" | "warning" | "info" | "question";

type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

export interface ConfirmationOptions {
  type?: ConfirmationType;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  /** Preferred — maps directly to Button variant */
  confirmVariant?: ButtonVariant;
  /** Alias kept for backward-compat (callers that pass `variant`) */
  variant?: ButtonVariant;
}

/**
 * Style config per type
 */
const typeConfig: Record<
  ConfirmationType,
  {
    icon: ReactNode;
    iconBg: string;
    accentBorder: string;
  }
> = {
  danger: {
    icon: <Trash2 className="h-5 w-5 text-red-600" />,
    iconBg: "bg-red-100 dark:bg-red-950/50",
    accentBorder: "border-t-red-500",
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
    iconBg: "bg-amber-100 dark:bg-amber-950/50",
    accentBorder: "border-t-amber-500",
  },
  info: {
    icon: <Info className="h-5 w-5 text-blue-600" />,
    iconBg: "bg-blue-100 dark:bg-blue-950/50",
    accentBorder: "border-t-blue-500",
  },
  question: {
    icon: <HelpCircle className="h-5 w-5 text-primary" />,
    iconBg: "bg-primary/10",
    accentBorder: "border-t-primary",
  },
};

/**
 * The confirmation dialog. `ConfirmationProvider` renders it for
 * `useConfirmation()`; a screen that keeps its own state (a `loading` confirm
 * button, extra content) renders it directly.
 */
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel?: () => void;
  type?: ConfirmationType;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: ButtonVariant;
  variant?: ButtonVariant;
  loading?: boolean;
  /** Optional extra content between the description and the buttons. */
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  type = "question",
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmVariant,
  variant,
  loading = false,
  children,
}: ConfirmDialogProps) {
  const btnVariant =
    confirmVariant || variant || (type === "danger" ? "destructive" : "default");
  const config = typeConfig[type];

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        {/* Above the Sheet (z-80 overlay, z-90 content): a confirm opened from a
            drawer must sit on top of it, or its buttons cannot be clicked. */}
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content
          className={cn(
            "fixed top-[50%] left-[50%] z-[100] w-full max-w-md translate-x-[-50%] translate-y-[-50%]",
            "rounded-xl border border-t-[3px] bg-background shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
            "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            "duration-200",
            config.accentBorder,
          )}
        >
          <button
            onClick={handleCancel}
            disabled={loading}
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>

          <div className="p-6 pb-0">
            <div className="flex flex-col items-center text-center">
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-full",
                  config.iconBg,
                )}
              >
                {config.icon}
              </div>
              <AlertDialogPrimitive.Title className="mt-4 text-lg font-semibold leading-tight">
                {title}
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-[340px]">
                {description}
              </AlertDialogPrimitive.Description>
              {children ? (
                <div className="mt-4 w-full text-start">{children}</div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3 p-6">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCancel}
              disabled={loading}
            >
              {cancelText}
            </Button>
            <Button
              variant={btnVariant}
              className="flex-1"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmText}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
