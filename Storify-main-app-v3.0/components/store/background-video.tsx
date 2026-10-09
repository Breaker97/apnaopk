import { backgroundOverlayCss, backgroundVideoSrc, type SlideBackground } from "@/lib/sliders/types";
import { cn } from "@/lib/utils";

/**
 * A background that plays: the video laid under a surface's content, with
 * the same darkening an image background takes.
 *
 * Muted, looping and inline, because a background that asks for sound — or
 * opens a player — is not a background. The poster (the background's own
 * `image`) paints first, which is also what a visitor who asked their system
 * to reduce motion keeps: the video hides itself for them, and the still
 * behind it stands in.
 *
 * Renders nothing unless the background actually is a video, so a caller can
 * drop it in beside its paint without asking.
 */
export function BackgroundVideo({
  background,
  className,
  style,
}: {
  background: SlideBackground;
  /** Extra classes for the video element (rounding). */
  className?: string;
  /** Inline style for the video element (the focal point's object position). */
  style?: React.CSSProperties;
}) {
  const src = backgroundVideoSrc(background);
  if (!src) return null;
  const overlay = backgroundOverlayCss(background);

  return (
    <>
      <video
        src={src}
        poster={background.image || undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full object-cover motion-reduce:hidden",
          className,
        )}
        style={style}
      />
      {overlay ? (
        <span aria-hidden="true" className="absolute inset-0" style={overlay} />
      ) : null}
    </>
  );
}
