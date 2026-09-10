import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import {
  fetchTestimonials,
  type TestimonialEntry,
} from "@/components/store/sections/testimonials";

interface LuxeTestimonialsProps {
  locale: Locale;
  title: string;
  minRating: number;
  limit: number;
}

/**
 * Luxe's take on the testimonials contract: the same approved reviews,
 * restyled as editorial pull quotes — serif, generous whitespace, no star
 * chrome. Same props, same data, different voice; that's what a theme
 * override is.
 */
export async function LuxeTestimonials({
  locale,
  title,
  minRating,
  limit,
}: LuxeTestimonialsProps) {
  const entries: TestimonialEntry[] = await fetchTestimonials(
    minRating,
    limit,
  );
  if (entries.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <section className="py-10 lg:py-16">
      <div className="container mx-auto max-w-4xl px-4">
        {title ? (
          <h2 className="mb-10 text-center font-serif text-2xl italic tracking-wide sm:text-3xl">
            {title}
          </h2>
        ) : null}
        <div className="space-y-10">
          {entries.slice(0, Math.min(limit, 4)).map((entry) => (
            <figure key={entry.id} className="text-center">
              <blockquote className="font-serif text-lg leading-relaxed text-foreground/90 sm:text-2xl">
                <span aria-hidden className="text-muted-foreground/60">
                  “
                </span>
                {entry.comment}
                <span aria-hidden className="text-muted-foreground/60">
                  ”
                </span>
              </blockquote>
              <figcaption className="mt-4 text-xs uppercase tracking-[0.25em] text-muted-foreground">
                — {entry.reviewerName || t("verifiedCustomer")}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
