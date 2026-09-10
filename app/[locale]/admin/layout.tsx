import { connectDB } from "@/lib/db";
import { USER_ROLES } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { AdminHeader } from "@/components/admin/admin-header";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { SidebarStateSync } from "@/components/layout/sidebar-state-sync";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function AdminLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The dashboards translate on the client with the whole bundle; the
  // storefront provider above this layout carries only the storefront subset.
  const messages = await getMessages();

  const session = await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const canAccessPos = Boolean(
    settings.pos?.enabled &&
      settings.pos?.allowAdminSales &&
      session.user.role === USER_ROLES.ADMIN,
  );

  return (
    <NextIntlClientProvider messages={messages}>
      <SidebarProvider>
        <SidebarStateSync />
        <DashboardSidebar
          locale={locale as Locale}
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image || undefined,
            role: session.user.role as string,
          }}
        />
        <SidebarInset className="[--dashboard-header-height:4rem]">
          <AdminHeader
            user={{
              name: session.user.name,
              email: session.user.email,
              image: session.user.image || undefined,
            }}
            locale={locale as Locale}
            role={session.user.role as string}
            posEnabled={canAccessPos}
          />
          <main className="isolate flex-1 min-w-0 space-y-8 overflow-x-clip p-6 md:p-6">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </NextIntlClientProvider>
  );
}
