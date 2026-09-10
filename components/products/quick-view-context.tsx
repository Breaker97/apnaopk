"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import type { ModernProduct } from "@/lib/products/modern-product";
import { type Locale } from "@/config/i18n.config";

const QuickViewContext = createContext<((product: ModernProduct) => void) | null>(
  null,
);

/**
 * Loaded on the first open, not with the page: the modal and its gallery /
 * option pickers are a sizeable chunk that most shoppers never trigger, and
 * the provider sits in the store layout, so a static import put it in every
 * storefront page's first load.
 */
const ProductQuickViewModal = dynamic(() =>
  import("@/components/products/product-quick-view-modal").then(
    (module) => module.ProductQuickViewModal,
  ),
);

/**
 * One storefront-wide quick view: a single modal mounted by the store layout
 * plus a context opener the product card falls back to when its surface
 * didn't wire an `onQuickView` of its own — so quick view behaves the same
 * on the home sections as on the listing grids instead of existing only
 * where a section happened to mount a modal. A surface's own handler still
 * wins via the prop, and outside the provider (admin previews) the card
 * simply hides the control, exactly as before.
 */
export function QuickViewProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const [product, setProduct] = useState<ModernProduct | null>(null);
  // Stays mounted after the first open so the close animation still plays.
  const [requested, setRequested] = useState(false);
  const open = useCallback((next: ModernProduct) => {
    setRequested(true);
    setProduct(next);
  }, []);

  return (
    <QuickViewContext.Provider value={open}>
      {children}
      {requested ? (
        <ProductQuickViewModal
          product={product}
          locale={locale}
          open={!!product}
          onClose={() => setProduct(null)}
        />
      ) : null}
    </QuickViewContext.Provider>
  );
}

export function useQuickViewOpener() {
  return useContext(QuickViewContext);
}
