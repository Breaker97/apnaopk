"use client";

// Storefront errors render inside the store layout, like the store's
// not-found page, so the fallback wears the active theme — its buttons
// included. Errors thrown by the layout itself still reach the locale-level
// boundary.
export { default } from "../error";
