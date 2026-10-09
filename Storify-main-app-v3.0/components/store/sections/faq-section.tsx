import { ChevronDown } from "lucide-react";
import { SectionHeading } from "./section-shell";

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

/**
 * Native <details> accordion: works without JavaScript, streams with the
 * page, and the browser handles open/close state.
 */
export function FaqSection({
  title,
  items,
}: {
  title: string;
  items: FaqEntry[];
}) {
  const visible = items.filter((item) => item.question && item.answer);
  if (visible.length === 0) return null;

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto max-w-3xl px-4">
        <SectionHeading title={title} className="mb-6" />
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border/70 bg-card">
          {visible.map((item) => (
            <details key={item.id} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 sm:p-5 [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-muted-foreground sm:px-5 sm:pb-5">
                {item.answer}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
