"use client";

import { create } from "zustand";

interface MobileMenuState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * Open state for the storefront's mobile menu drawer.
 *
 * The drawer itself is rendered by `StoreHeader` (only it has the categories,
 * collections and header settings the drawer needs), but its trigger lives in
 * `StoreBottomNav` — a sibling in the store layout, not a descendant. This
 * one-field store is the seam between them; there is nothing to persist and
 * nothing else to coordinate, so it deliberately stays this small.
 */
export const useMobileMenu = create<MobileMenuState>((set) => ({
  isOpen: false,
  setOpen: (open) => set({ isOpen: open }),
}));
