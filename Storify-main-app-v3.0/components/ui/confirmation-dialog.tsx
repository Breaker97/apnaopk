"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import type { ConfirmationOptions } from "@/components/ui/confirm-dialog";
import { useIdlePreload } from "@/hooks/use-idle-preload";

interface ConfirmationContextType {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
  confirmDelete: (itemName: string) => Promise<boolean>;
  confirmAction: (action: string, description?: string) => Promise<boolean>;
}

const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

/**
 * The dialog itself — Radix, its icons, the buttons — is in its own module:
 * the provider is on every page, the dialog on few, and never before the first
 * request. It is fetched when the page goes idle, so it is there by then.
 */
const ConfirmDialog = dynamic(() =>
  import("@/components/ui/confirm-dialog").then((module) => module.ConfirmDialog),
);
const preloadConfirmDialog = () => import("@/components/ui/confirm-dialog");

/**
 * Confirmation Dialog Provider
 */
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  useIdlePreload(preloadConfirmDialog);

  const confirm = useCallback((opts: ConfirmationOptions): Promise<boolean> => {
    setOptions(opts);
    setIsOpen(true);

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const confirmDelete = useCallback(
    (itemName: string): Promise<boolean> => {
      return confirm({
        type: "danger",
        title: "Delete Confirmation",
        description: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
        confirmText: "Delete",
        confirmVariant: "destructive",
      });
    },
    [confirm],
  );

  const confirmAction = useCallback(
    (action: string, description?: string): Promise<boolean> => {
      return confirm({
        type: "warning",
        title: `Confirm ${action}`,
        description:
          description || `Are you sure you want to ${action.toLowerCase()}?`,
        confirmText: "Confirm",
      });
    },
    [confirm],
  );

  const handleConfirm = () => {
    setIsOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  };

  const handleCancel = () => {
    setIsOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  };

  const isDestructive =
    options?.variant === "destructive" || options?.confirmVariant === "destructive";
  const type = options?.type || (isDestructive ? "danger" : "question");

  return (
    <ConfirmationContext.Provider
      value={{ confirm, confirmDelete, confirmAction }}
    >
      {children}

      {/* Mounted from the first request on. Closing it any way but Confirm —
          Cancel, the ×, Escape, the backdrop — answers false. */}
      {options ? (
        <ConfirmDialog
          open={isOpen}
          onOpenChange={(open) => {
            if (!open) handleCancel();
          }}
          onConfirm={handleConfirm}
          type={type}
          title={options.title}
          description={options.description}
          confirmText={options.confirmText || undefined}
          cancelText={options.cancelText || undefined}
          confirmVariant={options.confirmVariant}
          variant={options.variant}
        />
      ) : null}
    </ConfirmationContext.Provider>
  );
}

/**
 * Hook to use confirmation dialogs
 */
export function useConfirmation() {
  const context = useContext(ConfirmationContext);

  if (!context) {
    throw new Error(
      "useConfirmation must be used within a ConfirmationProvider",
    );
  }

  return context;
}
