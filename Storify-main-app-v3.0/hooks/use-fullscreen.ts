"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseFullscreenOptions {
  /** Called when the browser refuses the request (unsupported, blocked, iframe). */
  onError?: () => void;
}

/**
 * Browser fullscreen toggle for the whole document, kept in sync with the
 * native `fullscreenchange` event so Esc / F11 also update the button icon.
 */
export function useFullscreen({ onError }: UseFullscreenOptions = {}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Kept in a ref so an inline `onError` never changes `toggleFullscreen`'s
  // identity — callers list it in effect deps.
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await document.documentElement.requestFullscreen();
    } catch {
      onErrorRef.current?.();
    }
  }, []);

  return { isFullscreen, toggleFullscreen };
}
