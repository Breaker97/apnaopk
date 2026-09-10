import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize";

interface RichTextProps {
  heading: string;
  /** TipTap HTML — sanitized on write and again here at render. */
  body: string;
  width: "narrow" | "full";
}

/** Free-form rich text, styled exactly like the content pages. */
export function RichText({ heading, body, width }: RichTextProps) {
  const html = sanitizeHtml(body);
  if (!heading && !html) return null;

  return (
    <section className="py-5 lg:py-8">
      <div
        className={cn(
          "container mx-auto px-4",
          width === "narrow" && "max-w-3xl",
        )}
      >
        {heading ? (
          <h2 className="mb-4 text-[length:var(--sec-title,1.5rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.875rem)]">
            {heading}
          </h2>
        ) : null}
        {html ? (
          <div
            className="rich-text-content max-w-none text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
      </div>
    </section>
  );
}
