"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getExternalVideoEmbedUrl,
  type ExternalVideoProvider,
} from "@/lib/products/external-video";
import { AppImage } from "@/components/ui/app-image";

/**
 * "Lite embed" player for external product videos (YouTube/Vimeo).
 *
 * Renders only the thumbnail and a play button until the user clicks —
 * a YouTube iframe alone pulls ~1MB of third-party script, so eagerly
 * mounting one per gallery item would wreck the product page. The iframe
 * (privacy-enhanced youtube-nocookie / Vimeo dnt) is injected on demand
 * with autoplay so the click still feels like "play".
 *
 * Fills its parent — mount inside a positioned box. Key it by media id so
 * switching gallery items unloads the previous player.
 */
export function ExternalVideoPlayer({
  provider,
  embedId,
  title,
  thumbnailUrl,
  className,
}: {
  provider: ExternalVideoProvider;
  embedId: string;
  title: string;
  thumbnailUrl?: string;
  className?: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  if (isPlaying) {
    return (
      <iframe
        src={getExternalVideoEmbedUrl(provider, embedId, { autoplay: true })}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className={cn("h-full w-full border-0", className)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsPlaying(true)}
      aria-label={title}
      className={cn(
        "group/embed relative block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2",
        className,
      )}
    >
      {thumbnailUrl ? (
        <AppImage
          src={thumbnailUrl}
          alt={title}
          fill
          className="object-contain"
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 700px"
        />
      ) : (
        <span className="absolute inset-0 bg-muted" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md backdrop-blur transition-transform duration-200 group-hover/embed:scale-105">
          <Play className="ml-0.5 h-7 w-7 fill-current" />
        </span>
      </span>
    </button>
  );
}
