"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  label: string;
  className?: string;
}

function BackButtonImpl({ label, className }: BackButtonProps) {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => router.back()}
      className={cn("w-full sm:w-auto", className)}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

export const BackButton = React.memo(BackButtonImpl);

