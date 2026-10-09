"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { ProductFormOptions } from "@/lib/products/form-options-types";

export type ProductFormOptionsStatus = "loading" | "loaded" | "failed";

interface OptionsState {
  status: ProductFormOptionsStatus;
  /** The endpoint whose answer the form is showing, if any arrived. */
  loadedFor: string | null;
  /** The last answer was a failure (still true while a retry is in flight). */
  failed: boolean;
  /** The server's error code on that failure (`ApiClientError.code`). */
  errorCode: string | null;
  /** Whether any answer — success or failure — has arrived since mount. */
  settled: boolean;
}

/**
 * The product editor's reference data (categories, brands, collections,
 * locations, shipping context), with the four states the form has to tell
 * apart:
 *
 * - loading, before the first answer;
 * - loaded — possibly with empty lists, which is a real answer ("create a
 *   category first"), not an error;
 * - failed before anything loaded: the form keeps every edit, but cannot be
 *   saved — an edit would send no per-location stock, a new product could
 *   not get a category;
 * - failed after the lists had loaded: the earlier lists stay, and so does
 *   the ability to save.
 *
 * `retry` asks again for the reference data only; it never touches the form.
 * `onLoaded` is the form's own code for applying an answer. Only the newest
 * request's answer is applied, and none after unmount: every request takes a
 * number, and both a newer request and unmounting move the number on.
 */
export function useProductFormOptions(
  endpoint: string,
  onLoaded: (data: ProductFormOptions) => void,
) {
  const [state, setState] = useState<OptionsState>({
    status: "loading",
    loadedFor: null,
    failed: false,
    errorCode: null,
    settled: false,
  });
  const requestRef = useRef(0);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const data = await apiClient.get<ProductFormOptions>(endpoint);
      if (requestId !== requestRef.current) return;
      if (!data) throw new Error("The product form options came back empty");
      onLoadedRef.current(data);
      setState({
        status: "loaded",
        loadedFor: endpoint,
        failed: false,
        errorCode: null,
        settled: true,
      });
    } catch (error) {
      if (requestId !== requestRef.current) return;
      console.error("Failed to load product form options:", error);
      setState((current) => ({
        ...current,
        status: "failed",
        failed: true,
        errorCode: error instanceof ApiClientError ? (error.code ?? null) : null,
        settled: true,
      }));
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
    return () => {
      // Unmounted, or the form now edits another product: anything still in
      // flight answers for something that is gone.
      requestRef.current += 1;
    };
  }, [load]);

  return {
    status: state.status,
    /** No answer of any kind yet — the edit page waits on this one. */
    pending: !state.settled,
    /** These options belong to this endpoint: the form may be saved. */
    usable: state.loadedFor === endpoint,
    failed: state.failed,
    errorCode: state.errorCode,
    retry: load,
  };
}
