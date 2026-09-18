"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { apiClient } from "@/lib/api/client";

interface MenuOption {
  handle: string;
  name: string;
  isActive: boolean;
}

/**
 * One request per studio visit, shared by every picker on the page — the
 * menu button, each nav link's dropdown — rather than one per control.
 */
let menusRequest: Promise<MenuOption[]> | null = null;

function loadMenus(): Promise<MenuOption[]> {
  if (!menusRequest) {
    menusRequest = apiClient
      .get<{ handle?: unknown; name?: unknown; isActive?: unknown }[]>(
        "/api/menus",
      )
      .then((rows) =>
        (Array.isArray(rows) ? rows : []).flatMap((row) =>
          typeof row.handle === "string" && row.handle
            ? [
                {
                  handle: row.handle,
                  name: typeof row.name === "string" ? row.name : row.handle,
                  isActive: row.isActive !== false,
                },
              ]
            : [],
        ),
      )
      .catch(() => {
        // Let the next picker try again rather than caching the failure.
        menusRequest = null;
        return [];
      });
  }
  return menusRequest;
}

/**
 * A navigation menu, picked by HANDLE — the stable key menus are fetched by
 * on the storefront, so renaming a menu never unlinks it. An inactive menu
 * stays listed (it is still the merchant's) but is marked, because the
 * storefront will render nothing from it until it is switched back on.
 */
export function MenuSelect({
  value,
  onChange,
  noneLabel,
  inactiveLabel,
  manageLabel,
  ariaLabel,
}: {
  value: string;
  onChange: (handle: string) => void;
  noneLabel: string;
  inactiveLabel: string;
  manageLabel: string;
  ariaLabel: string;
}) {
  const locale = useLocale();
  const [menus, setMenus] = useState<MenuOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMenus().then((rows) => {
      if (!cancelled) setMenus(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A handle that no longer matches a menu (deleted since it was picked)
  // still shows, so the merchant can see what is linked and clear it.
  const missing =
    value && menus && !menus.some((menu) => menu.handle === value);

  return (
    <div className="space-y-1">
      <NativeSelect
        size="sm"
        value={value}
        aria-label={ariaLabel}
        disabled={menus === null}
        onChange={(event) => onChange(event.target.value)}
        className="w-full"
      >
        <option value="">{noneLabel}</option>
        {missing ? <option value={value}>{value}</option> : null}
        {(menus ?? []).map((menu) => (
          <option key={menu.handle} value={menu.handle}>
            {menu.isActive ? menu.name : `${menu.name} (${inactiveLabel})`}
          </option>
        ))}
      </NativeSelect>
      <Link
        href={`/${locale}/admin/online-store/menus`}
        target="_blank"
        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
      >
        {manageLabel}
        <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
