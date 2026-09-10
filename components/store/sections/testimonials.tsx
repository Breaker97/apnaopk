import { unstable_cache } from "next/cache";
import { Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";
import { connectDB } from "@/lib/db";
import { Review } from "@/models";
import { SectionHeading } from "./section-shell";

export interface TestimonialEntry {
  id: string;
  rating: number;
  title?: string;
  comment: string;
  reviewerName?: string;
}

/**
 * Approved storefront reviews, best-and-newest first. No entity tag exists
 * for reviews, so this leans on time-based revalidation alone — fine for a
 * social-proof strip. Exported so theme overrides restyle the same data.
 */
export const fetchTestimonials = unstable_cache(
  async (minRating: number, limit: number): Promise<TestimonialEntry[]> => {
    try {
      await connectDB();
      const reviews = await Review.find({
        isApproved: true,
        rating: { $gte: minRating },
        comment: { $exists: true, $nin: ["", null] },
      })
        .select("rating title comment userId createdAt")
        .populate("userId", "name")
        .sort({ rating: -1, createdAt: -1 })
        .limit(limit)
        .lean();

      return reviews.map((review) => {
        const user = review.userId as { name?: string } | null;
        return {
          id: String(review._id),
          rating: Number(review.rating) || 0,
          title: typeof review.title === "string" ? review.title : undefined,
          comment: String(review.comment ?? ""),
          reviewerName: user?.name || undefined,
        };
      });
    } catch {
      return [];
    }
  },
  ["section-testimonials"],
  { revalidate: 300 },
);

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
