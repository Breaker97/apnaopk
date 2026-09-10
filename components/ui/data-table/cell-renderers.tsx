"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AppImage } from "@/components/ui/app-image";
import { Package } from "lucide-react";
import { useCurrency } from "@/providers/currency-provider";

/**
 * Image cell with optional fallback
 */
interface ImageCellProps {
  src?: string | null;
  alt: string;
  size?: "sm" | "md" | "lg";
  rounded?: "none" | "sm" | "md" | "lg" | "full";
  fallback?: ReactNode;
}

const sizeMap = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

const roundedMap = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

function ImageCell({
  src,
  alt,
  size = "md",
  rounded = "md",
  fallback,
}: ImageCellProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-muted flex items-center justify-center",
        sizeMap[size],
        roundedMap[rounded],
      )}
    >
      {showImage ? (
        <AppImage
          src={src}
          alt={alt}
          fill
          sizes="48px"
          className="object-cover"
          onImageError={() => setFailed(true)}
        />
      ) : (
        fallback || <Package className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

/**
 * Product cell with image and title
 */
interface ProductCellProps {
  image?: string | null;
  title: string;
  subtitle?: string;
  href?: string;
  hoverStyle?: "default" | "blueUnderline";
  titleWordLimit?: number;
}

function truncateWords(value: string, limit?: number) {
  if (!limit || limit <= 0) return value;

  const words = value.trim().split(/\s+/);
  if (words.length <= limit) return value;

  return `${words.slice(0, limit).join(" ")}...`;
}

export function ProductCell({
  image,
  title,
  subtitle,
  href,
  hoverStyle = "default",
  titleWordLimit,
}: ProductCellProps) {
  const displayTitle = truncateWords(title, titleWordLimit);

  const content = (
    <div className="flex items-center gap-3">
      <ImageCell src={image} alt={title} size="lg" />
      <div className="min-w-0">
        <p
          className={cn(
            "font-medium truncate",
            href &&
              (hoverStyle === "blueUnderline"
                ? "hover:text-blue-600 hover:underline"
                : "hover:underline"),
          )}
          title={displayTitle !== title ? title : undefined}
        >
          {displayTitle}
        </p>
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

/**
 * Status badge cell
 */
interface StatusCellProps {
  status: string;
  variant?:
    | "default"
    | "secondary"
    | "destructive"
    | "outline"
    | "success"
    | "warning";
  statusMap?: Record<
    string,
    {
      label: string;
      variant: "default" | "secondary" | "destructive" | "outline";
    }
  >;
}

const defaultStatusMap: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  active: { label: "Active", variant: "default" },
  published: { label: "Active", variant: "default" },
  draft: { label: "Draft", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
  inactive: { label: "Inactive", variant: "outline" },
  pending: { label: "Pending", variant: "secondary" },
  unlisted: { label: "Unlisted", variant: "outline" },
};

export function StatusCell({
  status,
  statusMap = defaultStatusMap,
}: StatusCellProps) {
  const config = statusMap[status] || {
    label: status.charAt(0).toUpperCase() + status.slice(1),
    variant: "secondary" as const,
  };

  return (
    <Badge variant={config.variant} className="capitalize">
      {config.label}
    </Badge>
  );
}

/**
 * Text cell with optional truncation
 */
interface TextCellProps {
  value: string | number | null | undefined;
  fallback?: string;
  truncate?: boolean;
  maxWidth?: string;
  wordLimit?: number;
  className?: string;
}

function truncateTextCellWords(value: string, limit?: number) {
  if (!limit || limit <= 0) return value;

  const words = value.trim().split(/\s+/);
  if (words.length <= limit) return value;

  return `${words.slice(0, limit).join(" ")}...`;
}

export function TextCell({
  value,
  fallback = "—",
  truncate = false,
  maxWidth = "200px",
  wordLimit,
  className,
}: TextCellProps) {
  const originalValue = value != null && value !== "" ? String(value) : fallback;
  const displayValue =
    originalValue === fallback
      ? originalValue
      : truncateTextCellWords(originalValue, wordLimit);

  return (
    <span
      className={cn(truncate && "block truncate", className)}
      style={truncate ? { maxWidth } : undefined}
      title={
        originalValue !== fallback && (truncate || displayValue !== originalValue)
          ? originalValue
          : undefined
      }
    >
      {displayValue}
    </span>
  );
}

/**
 * Date cell with formatting
 */
interface DateCellProps {
  date: string | Date | null | undefined;
  format?: "short" | "medium" | "long" | "relative";
  fallback?: string;
}

export function DateCell({
  date,
  format = "medium",
  fallback = "—",
}: DateCellProps) {
  if (!date) return <span className="text-muted-foreground">{fallback}</span>;

  const dateObj = typeof date === "string" ? new Date(date) : date;

  if (format === "relative") {
    const now = new Date();
    const diff = now.getTime() - dateObj.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return <span>Today</span>;
    if (days === 1) return <span>Yesterday</span>;
    if (days < 7) return <span>{days} days ago</span>;
    if (days < 30) return <span>{Math.floor(days / 7)} weeks ago</span>;
    if (days < 365) return <span>{Math.floor(days / 30)} months ago</span>;
    return <span>{Math.floor(days / 365)} years ago</span>;
  }

  const options: Intl.DateTimeFormatOptions =
    format === "short"
      ? { month: "short", day: "numeric" }
      : format === "long"
        ? {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
          }
        : { year: "numeric", month: "short", day: "numeric" };

  return <span>{dateObj.toLocaleDateString(undefined, options)}</span>;
}

/**
 * Number/Count cell
 */
interface NumberCellProps {
  value: number | null | undefined;
  fallback?: string;
  suffix?: string;
  prefix?: string;
}

export function NumberCell({
  value,
  fallback = "0",
  suffix,
  prefix,
}: NumberCellProps) {
  const displayValue = value != null ? value.toLocaleString() : fallback;

  return (
    <span>
      {prefix}
      {displayValue}
      {suffix}
    </span>
  );
}

/**
 * Currency cell
 *
 * Always renders in the store's current currency. Rows carry the code they were
 * charged in (`order.currency`, `payout.currency`), but honouring it made one
 * order read "USh 308" in the order list and "$308.00" in Payments — so the
 * store currency is the single label across every surface. There is deliberately
 * no per-row override: amounts are relabelled, never converted.
 */
interface CurrencyCellProps {
  value: number | null | undefined;
}

export function CurrencyCell({ value }: CurrencyCellProps) {
  const { formatPrice } = useCurrency();
  if (value == null) return <span className="text-muted-foreground">—</span>;

  return <span>{formatPrice(value)}</span>;
}

