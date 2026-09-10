"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@/components/ui/native-select";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";
import type { PageSwitcher } from "@/lib/storefront/pages/page-switcher";

/**
 * The storefront editor's page switcher. Every surface it can reach renders
 * it in the same place — the section builder, the checkout editor, the
 * product card configurator — so switching pages never depends on which
 * editor happens to be open, and no dedicated editor is a dead end the
 * merchant has to back out of.
 *
 * `nav:` values are dedicated editors on their own routes; everything else
 * is a `?page=` ref on the Customize route.
 */
export function PageSwitcherSelect({
  switcher,
  locale,
  variant = "control",
  className,
}: {
  switcher: PageSwitcher;
  locale: string;
  /**
   * "title" IS the page heading — the editor names the page once, and that
   * name is the control that changes it. "control" is the ordinary select,
   * for surfaces that carry their own heading.
   */
  variant?: "title" | "control";
  className?: string;
}) {
  const router = useRouter();
  const tSafe = createTSafe(useTranslations());

  return (
    <NativeSelect
      aria-label={tSafe("admin.storeBuilder.switcher.label", "Page")}
      value={switcher.current}
      className={cn(
        variant === "title" &&
          "h-auto cursor-pointer rounded-none border-0 bg-transparent px-0 py-0 text-lg font-semibold tracking-tight shadow-none transition-colors hover:text-primary focus-visible:ring-0",
        className,
      )}
      onChange={(event) => {
        const value = event.target.value;
        if (value === switcher.current) return;
        if (value.startsWith("nav:")) {
          router.push(`/${locale}${value.slice(4)}`);
          return;
        }
        router.push(
          `/${locale}/admin/online-store/customize?page=${encodeURIComponent(value)}`,
        );
      }}
    >
      <optgroup
        label={tSafe("admin.storeBuilder.switcher.templates", "Templates")}
      >
        {switcher.templates.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </optgroup>
      {switcher.landingPages.length > 0 ? (
        <optgroup
          label={tSafe(
            "admin.storeBuilder.switcher.landingPages",
            "Landing pages",
          )}
        >
          {switcher.landingPages.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label={tSafe("admin.storeBuilder.switcher.global", "Global")}>
        {switcher.globalPages.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </optgroup>
    </NativeSelect>
  );
}
