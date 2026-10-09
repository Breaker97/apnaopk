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
 * Starts loading the modal's code. The card calls it on the same pointer,
 * touch and focus intents that preload the product, so the first open waits
 * for neither.
 */
export function preloadQuickViewModal() {
  void import("@/components/products/product-quick-view-modal");
}

/**
 * The storefront's one quick view: a single modal mounted by the store layout
 * and a context opener every product card uses. Grids and carousels used to
 * mount modals of their own; a static import in any of them put the modal in
 * every storefront page's first load. Outside the provider (admin previews)
 * the card hides the control.
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
