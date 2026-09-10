import * as React from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusPageShellProps {
  code?: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function StatusPageShell({
  code,
  title,
  description,
  icon,
  children,
  primaryAction,
  secondaryAction,
  className,
}: StatusPageShellProps) {
  return (
    <main
      className={cn(
        "min-h-[70vh] w-full px-4 py-10 sm:py-16",
        "animate-in fade-in duration-200",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-center">
        <Card className="w-full">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {icon ? (
                  <div
                    className="grid size-10 place-items-center rounded-lg bg-muted text-foreground"
                    aria-hidden="true"
                  >
                    {icon}
                  </div>
                ) : null}
                <div className="space-y-1">
                  <h1 className="text-balance text-lg font-semibold leading-tight sm:text-xl">
                    {title}
                  </h1>
                  {description ? (
                    <p className="text-pretty text-sm text-muted-foreground">
                      {description}
                    </p>
                  ) : null}
                </div>
              </div>
              {code ? <Badge variant="secondary">{code}</Badge> : null}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">{children}</CardContent>

          <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {secondaryAction ? (
              <div className="w-full sm:w-auto">{secondaryAction}</div>
            ) : null}
            {primaryAction ? (
              <div className="w-full sm:w-auto">{primaryAction}</div>
            ) : null}
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
