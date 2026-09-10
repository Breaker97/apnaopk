"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Home, RefreshCcw } from "lucide-react";
import { useErrorReporting } from "@/hooks/use-error-reporting";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ErrorFallbackProps {
  title: string;
  description: string;
  homeLabel: string;
  retryLabel: string;
  homeHref: string;
  error: Error & { digest?: string };
  onRetry: () => void;
  locale?: string;
  route?: string;
  className?: string;
}

function ErrorFallbackImpl({
  title,
  description,
  homeLabel,
  retryLabel,
  homeHref,
  error,
  onRetry,
  locale,
  route,
  className,
}: ErrorFallbackProps) {
  useErrorReporting(error, { digest: error.digest, locale, route });

  const showDetails = process.env.NODE_ENV !== "production";

  return (
    <main
      className={cn(
        "min-h-[70vh] w-full px-4 py-10 sm:py-16",
        "animate-in fade-in duration-200",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-2xl">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="grid size-10 place-items-center rounded-lg bg-destructive/10 text-destructive"
                  aria-hidden="true"
                >
                  <AlertTriangle className="size-5" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-balance text-lg font-semibold leading-tight sm:text-xl">
                    {title}
                  </h1>
                  <p className="text-pretty text-sm text-muted-foreground">
                    {description}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <Alert>
              <AlertTitle>{title}</AlertTitle>
              <AlertDescription className="text-sm text-muted-foreground">
                {showDetails ? error.message : description}
              </AlertDescription>
            </Alert>

            {showDetails ? (
              <div className="space-y-2">
                {error.digest ? (
                  <p className="text-xs text-muted-foreground">
                    Digest: <span className="font-mono">{error.digest}</span>
                  </p>
                ) : null}
                {error.stack ? (
                  <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    {error.stack}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </CardContent>

          <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" asChild className="w-full sm:w-auto">
              <Link href={homeHref}>
                <Home className="size-4" aria-hidden="true" />
                {homeLabel}
              </Link>
            </Button>
            <Button type="button" onClick={onRetry} className="w-full sm:w-auto">
              <RefreshCcw className="size-4" aria-hidden="true" />
              {retryLabel}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

export const ErrorFallback = React.memo(ErrorFallbackImpl);
