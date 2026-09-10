import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Ban,
  Box,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileText,
  PackageCheck,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import type { ReturnPolicyPageData } from "@/lib/site-config/content-pages-config";

const stepIcons: LucideIcon[] = [
  ReceiptText,
  ClipboardCheck,
  ShieldCheck,
  Truck,
  CreditCard,
];

const refundIcons: LucideIcon[] = [
  CreditCard,
  RefreshCcw,
  FileText,
  PackageCheck,
];

const summaryIcons = [
  { icon: CheckCircle2, className: "text-emerald-600" },
  { icon: Undo2, className: "text-blue-600" },
  { icon: AlertTriangle, className: "text-amber-600" },
];

function withStoreName(value: string, storeName: string) {
  return value.replace(/\{storeName\}/g, storeName);
}

export function ReturnPolicyPageView({
  locale,
  page,
  storeName,
  supportEmail,
  supportPhone,
}: {
  locale: string;
  page: ReturnPolicyPageData;
  storeName: string;
  supportEmail?: string;
  supportPhone?: string;
}) {
  return (
    <main className="bg-background">
      <section className="border-b bg-muted/20">
        <div className="container mx-auto grid gap-10 px-4 pb-12 pt-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end lg:pb-16 lg:pt-10">
          <div className="max-w-3xl">
            <StoreBreadcrumb locale={locale} items={[{ label: page.title }]} />

            <Badge variant="outline" className="mb-4 gap-2 rounded-md">
              <RotateCcw className="h-3.5 w-3.5" />
              {page.eyebrow}
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
              {page.title}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              {withStoreName(page.description, storeName)}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <Link href={`/${locale}/account/orders`}>
                  {page.primaryActionLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/${locale}/track-order`}>
                  {page.secondaryActionLabel}
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {page.returnWindowLabel}
                </p>
                <p className="text-lg font-semibold">
                  {page.returnWindowValue}
                </p>
              </div>
            </div>
            <Separator />
            <div className="grid gap-3 text-sm">
              {page.summaryItems.map((item, index) => {
                const Icon = summaryIcons[index]?.icon ?? CheckCircle2;
                const className =
                  summaryIcons[index]?.className ?? "text-emerald-600";

                return (
                  <div key={item.id} className="flex items-start gap-3">
                    <Icon className={`mt-0.5 h-4 w-4 ${className}`} />
                    <span>{item.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {page.howItWorksTitle}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {page.howItWorksDescription}
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {page.steps.map((step, index) => {
              const Icon = stepIcons[index] ?? ClipboardCheck;

              return (
                <div
                  key={step.id}
                  className="rounded-lg border bg-card p-5 shadow-sm"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/20 py-12 md:py-16">
        <div className="container mx-auto grid gap-8 px-4 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-3">
              <BadgeCheck className="h-6 w-6 text-emerald-600" />
              <h2 className="text-2xl font-semibold tracking-tight">
                {page.eligibleTitle}
              </h2>
            </div>
            <div className="mt-5 grid gap-3">
              {page.eligibleItems.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-3 rounded-lg border bg-card p-4"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <p className="text-sm leading-6 text-muted-foreground">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <Ban className="h-6 w-6 text-red-600" />
              <h2 className="text-2xl font-semibold tracking-tight">
                {page.excludedTitle}
              </h2>
            </div>
            <div className="mt-5 grid gap-3">
              {page.excludedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-3 rounded-lg border bg-card p-4"
                >
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <p className="text-sm leading-6 text-muted-foreground">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto grid gap-10 px-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {page.refundRulesTitle}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {page.refundRulesDescription}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {page.refundRules.map((rule, index) => {
              const Icon = refundIcons[index] ?? FileText;

              return (
                <div key={rule.id} className="rounded-lg border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <h3 className="font-semibold">{rule.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {rule.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/20 py-12 md:py-16">
        <div className="container mx-auto grid gap-10 px-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {page.statusesTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              {page.statusesDescription}
            </p>
            <div className="mt-6 overflow-hidden rounded-lg border bg-card">
              {page.statuses.map((status, index) => (
                <div
                  key={status.id}
                  className="grid gap-2 border-b p-4 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)]"
                >
                  <div className="flex items-center gap-3 font-medium">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs">
                      {index + 1}
                    </span>
                    {status.label}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {status.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-3">
              <Box className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold">{page.beforeReturnTitle}</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {page.beforeReturnDescription}
            </p>
            <Separator className="my-5" />
            <div className="grid gap-3 text-sm">
              <p className="font-medium">{page.helpTitle}</p>
              {supportEmail ? (
                <a
                  href={`mailto:${supportEmail}`}
                  className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  {supportEmail}
                </a>
              ) : null}
              {supportPhone ? (
                <a
                  href={`tel:${supportPhone.replace(/\s+/g, "")}`}
                  className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  {supportPhone}
                </a>
              ) : null}
              {!supportEmail && !supportPhone ? (
                <p className="text-muted-foreground">
                  Contact the store team from your order details page.
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="rounded-lg border bg-card p-6 md:p-8">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {page.ctaTitle}
                </h2>
                <p className="mt-3 text-muted-foreground">
                  {page.ctaDescription}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Button asChild>
                  <Link href={`/${locale}/account/orders`}>
                    {page.ctaPrimaryLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/${locale}/track-order`}>
                    {page.ctaSecondaryLabel}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
