"use client";

/* eslint-disable @typescript-eslint/no-namespace */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          "auto-rotate"?: boolean;
          "camera-controls"?: boolean;
          "shadow-intensity"?: string | number;
          "interaction-prompt"?: string;
          "environment-image"?: string;
          ar?: boolean;
          crossorigin?: "anonymous" | "use-credentials";
          crossOrigin?: "anonymous" | "use-credentials";
          loading?: "auto" | "lazy" | "eager";
          reveal?: "auto" | "interaction" | "manual";
          poster?: string;
        },
        HTMLElement
      >;
    }
  }
}

let modelViewerLoadPromise: Promise<unknown> | null = null;
type ModelViewerStatus = "loading" | "ready" | "error";
type ViewerState = {
  originalSrc: string;
  activeSrc: string;
  useProxy: boolean;
  status: ModelViewerStatus;
  errorMsg: string | null;
};

function ensureModelViewerLoaded() {
  if (typeof window === "undefined") return;
  // The custom-element registry is page-global and survives dev hot
  // reloads, but this module's scope does not: after HMR the reset
  // `modelViewerLoadPromise` would import the library again, whose
  // top-level `customElements.define("model-viewer")` then throws
  // NotSupportedError. Already registered means already loaded.
  if (!modelViewerLoadPromise && customElements.get("model-viewer")) {
    modelViewerLoadPromise = Promise.resolve();
  }
  if (!modelViewerLoadPromise) {
    modelViewerLoadPromise = import("@google/model-viewer").catch((err) => {
      modelViewerLoadPromise = null;
      console.error("Failed to load <model-viewer>:", err);
    });
  }
}

function isRemoteHttpUrl(src: string) {
  return /^https?:\/\//i.test(src);
}

function toProxySrc(src: string) {
  return `/api/media/model?url=${encodeURIComponent(src)}`;
}

export function ModelViewer({
  src,
  alt,
  className,
  autoRotate = false,
  cameraControls = false,
  loading = "eager",
  preferProxy = true,
  poster,
}: {
  src: string;
  alt?: string;
  className?: string;
  autoRotate?: boolean;
  cameraControls?: boolean;
  loading?: "auto" | "lazy" | "eager";
  preferProxy?: boolean;
  poster?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLElement>(null);
  const [isInView, setIsInView] = useState(() => loading !== "lazy");
  const shouldProxyInitialSrc = preferProxy && isRemoteHttpUrl(src);
  const [viewerState, setViewerState] = useState<ViewerState>(() => ({
    originalSrc: src,
    activeSrc: shouldProxyInitialSrc ? toProxySrc(src) : src,
    useProxy: shouldProxyInitialSrc,
    status: "loading",
    errorMsg: null,
  }));

  const useProxy =
    viewerState.originalSrc === src
      ? viewerState.useProxy
      : shouldProxyInitialSrc;
  const activeSrc = useMemo(() => {
    if (useProxy && isRemoteHttpUrl(src)) return toProxySrc(src);
    return src;
  }, [src, useProxy]);
  const stateMatches =
    viewerState.originalSrc === src && viewerState.activeSrc === activeSrc;
  const visibleSrc = isInView ? activeSrc : undefined;
  const status = stateMatches && isInView ? viewerState.status : "loading";
  const errorMsg = stateMatches ? viewerState.errorMsg : null;

  useEffect(() => {
    if (isInView) {
      ensureModelViewerLoaded();
    }
  }, [isInView]);

  useEffect(() => {
    if (isInView) return;

    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "350px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isInView]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !isInView) return;

    const onLoad = () =>
      setViewerState({
        originalSrc: src,
        activeSrc,
        useProxy,
        status: "ready",
        errorMsg: null,
      });
    const onError = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { type?: string; sourceError?: { message?: string } }
        | undefined;
      const raw =
        detail?.sourceError?.message ||
        detail?.type ||
        "Failed to load 3D model";

      if (!useProxy && isRemoteHttpUrl(src)) {
        setViewerState({
          originalSrc: src,
          activeSrc: toProxySrc(src),
          useProxy: true,
          status: "loading",
          errorMsg: null,
        });
        return;
      }

      const looksLikeCors = /failed to fetch|cors|reading 'scene'/i.test(raw);
      setViewerState({
        originalSrc: src,
        activeSrc,
        useProxy,
        status: "error",
        errorMsg: looksLikeCors
          ? "Storage CORS blocked the model. Allow GET and HEAD for this exact origin."
          : raw,
      });
    };

    node.addEventListener("load", onLoad);
    node.addEventListener("error", onError);
    return () => {
      node.removeEventListener("load", onLoad);
      node.removeEventListener("error", onError);
    };
  }, [activeSrc, isInView, src, useProxy]);

  return (
    <div ref={rootRef} className={cn("relative h-full w-full", className)}>
      <model-viewer
        ref={ref as never}
        src={visibleSrc}
        alt={alt}
        auto-rotate={(autoRotate && isInView) || undefined}
        camera-controls={cameraControls || undefined}
        shadow-intensity="0.6"
        interaction-prompt="none"
        loading={loading}
        reveal="auto"
        poster={poster}
        crossorigin="anonymous"
        environment-image="neutral"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          backgroundColor: "transparent",
        }}
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted/40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted p-3 text-center">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <p className="text-xs font-medium">3D viewer failed</p>
          <p className="px-2 text-[10px] text-muted-foreground">
            {errorMsg}
          </p>
          {/* Not an <a>: the viewer often renders inside a product-card
              <Link>, and nested anchors are invalid HTML (hydration error). */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(src, "_blank", "noopener,noreferrer");
            }}
            className="mt-1 cursor-pointer text-[10px] text-primary underline"
          >
            Open file directly
          </button>
        </div>
      )}
    </div>
  );
}
