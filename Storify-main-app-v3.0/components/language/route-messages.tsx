import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import {
  withRouteMessages,
  type RouteScopedNamespace,
} from "@/lib/i18n/surface-messages";

/**
 * The storefront bundle plus the namespaces a route renders in full
 * (`ROUTE_SCOPED_NAMESPACES`), for the client components under it. A route's
 * layout or page wraps its content in it; the chrome outside — header, drawers,
 * bottom nav — keeps the bundle every page shares.
 */
export async function RouteMessages({
  namespaces,
  children,
}: {
  namespaces: readonly RouteScopedNamespace[];
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      messages={withRouteMessages(await getMessages(), namespaces)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
