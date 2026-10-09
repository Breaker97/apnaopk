"use client";

import * as React from "react";
import { Camera, Loader2, RotateCcw, ScanLine, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;

type ScannerControls = { stop: () => void };

type BarcodeCameraDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (code: string, source: "camera") => void;
  isResolving?: boolean;
};

const BARCODE_FORMATS = [
  "aztec",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "data_matrix",
  "ean_13",
  "ean_8",
  "itf",
  "pdf417",
  "qr_code",
  "upc_a",
  "upc_e",
];

function getBarcodeDetector() {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
}

/**
 * Camera failures are silent by default (a black box that never starts), so
 * every path has to end in a message the cashier can act on.
 */
function describeCameraError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow the camera for this site, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device.";
  }
  if (name === "NotReadableError") {
    return "The camera is already in use by another app or tab.";
  }
  return "Unable to start the camera scanner.";
}

export function BarcodeCameraDialog({
  open,
  onOpenChange,
  onScan,
  isResolving,
}: BarcodeCameraDialogProps) {
  // The <video> is rendered inside a portalled Radix DialogContent, which
  // renders nothing on the first pass after `open` flips true. A plain ref is
  // therefore still null when a start effect keyed on `open` fires, and the
  // scanner would sit on "Starting camera scanner..." forever. Holding the
  // element in state means the effect re-runs the moment it actually attaches.
  const [videoEl, setVideoEl] = React.useState<HTMLVideoElement | null>(null);
  const lastScanRef = React.useRef<{ code: string; at: number } | null>(null);
  const [mode, setMode] = React.useState<"native" | "zxing" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  // Kept in a ref so a parent passing an inline `onScan` cannot invalidate the
  // start effect and tear the camera down between scans.
  const onScanRef = React.useRef(onScan);
  React.useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const emitScan = React.useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === trimmed && now - last.at < 900) return;

    lastScanRef.current = { code: trimmed, at: now };
    onScanRef.current(trimmed, "camera");
  }, []);

  React.useEffect(() => {
    if (!open || !videoEl) return;

    const video = videoEl;
    let stopped = false;
    let frameId = 0;
    // Acquisition is async, so the cleanup routinely runs while getUserMedia is
    // still pending. Parking the handles here (rather than in effect-local
    // `let`s the cleanup reads too early) is what lets a late arrival be shut
    // down instead of leaving the camera live after the dialog closes.
    const acquired: { stream: MediaStream | null; controls: ScannerControls | null } =
      { stream: null, controls: null };

    const release = () => {
      acquired.controls?.stop();
      acquired.controls = null;
      acquired.stream?.getTracks().forEach((track) => track.stop());
      acquired.stream = null;
      video.srcObject = null;
    };

    async function startNativeScanner(Detector: BarcodeDetectorConstructor) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      acquired.stream = stream;
      if (stopped) return release();

      video.srcObject = stream;
      await video.play();
      if (stopped) return release();

      const detector = new Detector({ formats: BARCODE_FORMATS });
      setMode("native");

      const scanFrame = async () => {
        if (stopped) return;
        try {
          const results = await detector.detect(video);
          const code = results.find((result) => result.rawValue)?.rawValue;
          if (code) emitScan(code);
        } catch {
          // Keep the camera loop alive; individual frames can fail on motion.
        }
        if (stopped) return;
        frameId = window.requestAnimationFrame(scanFrame);
      };

      frameId = window.requestAnimationFrame(scanFrame);
    }

    async function startZxingScanner() {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (stopped) return;

      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        video,
        (result) => {
          const code = result?.getText();
          if (code) emitScan(code);
        },
      );
      acquired.controls = controls;
      if (stopped) return release();

      setMode("zxing");
    }

    async function start() {
      setError(null);
      setMode(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Camera access is not available in this browser. It also needs a secure (https) connection.",
        );
        return;
      }

      try {
        const Detector = getBarcodeDetector();
        if (Detector) {
          try {
            await startNativeScanner(Detector);
            return;
          } catch {
            if (stopped) return;
            // ZXing opens its own camera stream, so the half-started native one
            // has to be handed back first or the device reads as busy.
            release();
          }
        }
        // Reached either because the browser has no BarcodeDetector or because
        // the native path failed — never both, so the camera is only prompted
        // for once per fallback.
        await startZxingScanner();
      } catch (err) {
        if (stopped) return;
        release();
        setError(describeCameraError(err));
      }
    }

    void start();

    return () => {
      stopped = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      release();
      setMode(null);
      setError(null);
    };
  }, [attempt, emitScan, open, videoEl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            Camera scanner
          </DialogTitle>
          <DialogDescription>
            {mode === "native"
              ? "Using browser barcode detection."
              : mode === "zxing"
                ? "Using ZXing camera detection."
                : error
                  ? "Camera scanner unavailable."
                  : "Starting camera scanner..."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-md border bg-black aspect-[4/3]">
          <video
            ref={setVideoEl}
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-36 w-56 rounded-md border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />
          </div>
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground">
            {isResolving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            {isResolving ? "Resolving scan" : "Ready to scan"}
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          {error ? (
            <Button
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
