import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import {
  fillContentPagePlaceholders,
  windowPlaceholders,
} from "@/lib/site-config/content-pages-config";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FaqPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { storeDefault } = await getLocaleRouting();

  const { contentPages, returnWindowDays, storeName } = await getStorefrontSettings();
  if (!contentPages.faq.visible) {
    notFound();
  }
  // The answers may quote the store's name and return window, which the
  // default one about returns does.
  const faq = fillContentPagePlaceholders(contentPages.faq, {
    storeName,
    returnWindow: contentPages.returns.returnWindowValue,
    ...windowPlaceholders(returnWindowDays),
  });

  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto max-w-4xl px-4">
        <StoreBreadcrumb
          locale={locale}
          storeDefault={storeDefault}
          items={[{ label: faq.title }]}
        />

        <article className="rounded-2xl border border-border/70 bg-card/95 p-6 md:p-8">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            {faq.title}
          </h1>
          {faq.subtitle ? (
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              {faq.subtitle}
            </p>
          ) : null}

          <Accordion
            type="single"
            collapsible
            className="mt-8 rounded-xl border border-border/70 px-4"
          >
            {faq.items.map((item) => (
              <AccordionItem key={item.id} value={item.id}>
                <AccordionTrigger className="text-base font-medium hover:no-underline">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground md:text-base">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </article>
      </div>
    </section>
  );
}
