import { Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-shell";
import { fetchTestimonials } from "@/lib/storefront/section-data/content";

interface TestimonialsProps {
  locale: Locale;
  title: string;
  minRating: number;
  limit: number;
}

export async function Testimonials({
  locale,
  title,
  minRating,
  limit,
}: TestimonialsProps) {
  const entries = await fetchTestimonials(minRating, limit);
  if (entries.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <SectionHeading title={title} className="mb-6" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <figure
              key={entry.id}
              className="flex flex-col gap-3 rounded-md border border-border/70 bg-card p-5"
            >
              <div
                className="flex items-center gap-0.5"
                aria-label={`${entry.rating}/5`}
              >
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star
                    key={index}
                    className={cn(
                      "h-4 w-4",
                      index < entry.rating
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30",
                    )}
                    aria-hidden
                  />
                ))}
              </div>
              <blockquote className="text-sm leading-relaxed text-muted-foreground">
                {entry.title ? (
                  <span className="mb-1 block font-semibold text-foreground">
                    {entry.title}
                  </span>
                ) : null}
                <span className="line-clamp-4">{entry.comment}</span>
              </blockquote>
              <figcaption className="mt-auto text-xs font-medium text-foreground">
                {entry.reviewerName || t("verifiedCustomer")}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
