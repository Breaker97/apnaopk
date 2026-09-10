"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
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

interface ConfirmationOptions {
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

interface ConfirmationContextType {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
  confirmDelete: (itemName: string) => Promise<boolean>;
  confirmAction: (action: string, description?: string) => Promise<boolean>;
}

const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

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

/** Resolve the effective button variant from options */
function resolveVariant(opts: ConfirmationOptions | null): ButtonVariant {
  if (!opts) return "default";
  if (opts.confirmVariant) return opts.confirmVariant;
  if (opts.variant) return opts.variant;
  const type = opts.type || "question";
  return type === "danger" ? "destructive" : "default";
}

/**
 * Confirmation Dialog Provider
 */
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

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
  const config = typeConfig[type];
  const confirmVariant = resolveVariant(options);

  return (
    <ConfirmationContext.Provider
      value={{ confirm, confirmDelete, confirmAction }}
    >
      {children}

      <AlertDialogPrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogPrimitive.Portal>
          <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <AlertDialogPrimitive.Content
            className={cn(
              "fixed top-[50%] left-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%]",
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
            {/* Close button */}
            <button
              onClick={handleCancel}
              className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>

            {/* Body */}
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
                  {options?.title}
                </AlertDialogPrimitive.Title>
                <AlertDialogPrimitive.Description className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-[340px]">
                  {options?.description}
                </AlertDialogPrimitive.Description>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 p-6">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleCancel}
              >
                {options?.cancelText || "Cancel"}
              </Button>
              <Button
                variant={confirmVariant}
                className="flex-1"
                onClick={handleConfirm}
              >
                {options?.confirmText || "Confirm"}
              </Button>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Portal>
      </AlertDialogPrimitive.Root>
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

/**
 * Standalone confirmation dialog component
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
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content
          className={cn(
            "fixed top-[50%] left-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%]",
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
                <div className="mt-4 w-full text-left">{children}</div>
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
