"use client";

import * as React from "react";
import { ErrorFallback } from "@/components/errors/error-fallback";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorFallback
          title="Something went wrong"
          description="An unexpected error occurred. Please try again."
          homeLabel="Home"
          retryLabel="Try again"
          homeHref="/en"
          error={error}
          onRetry={reset}
        />
      </body>
    </html>
  );
}

