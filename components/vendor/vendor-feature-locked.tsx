"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, CreditCard, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";

interface VendorFeatureLockedProps {
  locale: string;
  title: string;
  description: string;
  paymentDueAt?: string | null;
  /** Things the vendor can still do right now, shown as a fallback checklist. */
  suggestions?: { href: string; title: string; description: string }[];
}

/**
 * Shown instead of a paid vendor feature while the vendor is still in the
 * payment-required setup window. Replaces the raw AuthorizationError that
 * the server guards throw for these features.
 */
export function VendorFeatureLocked({
  locale,
  title,
  description,
  paymentDueAt,
  suggestions = [],
}: VendorFeatureLockedProps) {
  const [loading, setLoading] = useState(false);

  async function startPayment() {
    setLoading(true);
    try {
      const response = await fetch("/api/vendor/applications/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data?.url) {
        toast.error(body?.message || "Could not start Stripe Checkout");
        return;
      }
      window.location.assign(body.data.url);
    } catch {
      toast.error("Could not start Stripe Checkout");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="border bg-card px-6 py-10 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-6" />
        </span>
        <h2 className="mt-4 text-xl font-bold text-foreground">{title}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {paymentDueAt ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Your setup period ends on{" "}
            {new Date(paymentDueAt).toLocaleString()}.
          </p>
        ) : null}
        <Button
          type="button"
          onClick={startPayment}
          disabled={loading}
          className="mt-6"
        >
          <CreditCard className="mr-2 size-4" />
          {loading ? "Opening Stripe..." : "Complete payment"}
        </Button>
      </section>

      {suggestions.length ? (
        <section className="overflow-hidden border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="font-semibold text-foreground">
              What you can do now
            </h3>
          </div>
          <div className="divide-y">
            {suggestions.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
