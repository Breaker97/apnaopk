"use client";

import { useEffect, type ComponentProps } from "react";
import * as sonner from "sonner";

/**
 * Sonner and its toaster, in a chunk of their own (see toast-notification.tsx).
 * `onReady` hands Sonner over once the toaster is listening: a child's effect
 * runs before its parent's, so nothing sent from then on is missed.
 */
export function ToastHost({
  onReady,
  ...props
}: ComponentProps<typeof sonner.Toaster> & {
  onReady: (module: typeof sonner) => void;
}) {
  useEffect(() => {
    onReady(sonner);
  }, [onReady]);
  return <sonner.Toaster {...props} />;
}
