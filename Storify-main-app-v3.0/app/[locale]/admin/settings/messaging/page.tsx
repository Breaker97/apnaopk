import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getPlatformMessagingConfiguration } from "@/lib/notifications/platform-messaging";
import { ChannelConnectionsSection } from "@/components/chat/channel-connections-section";
import { ChannelConnectionsPanelSkeleton } from "@/components/chat/channel-connections-panel";
import { PlatformLiveChatSettingsPanel } from "@/components/chat/platform-live-chat-settings-panel";
import { SettingsTabHeader } from "@/components/admin/settings/sections/settings-tab-header";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Omnichannel configuration, alongside every other store setting.
 *
 * This section deliberately does NOT go through `SectionLoader` /
 * `saveSection` like the others: channel connections are their own collection
 * (each row holding an encrypted provider credential) and live-chat hours are
 * their own singleton, so both panels own their loading and saving. Folding
 * them into the shared settings document would mean putting access tokens in
 * the same payload the settings API returns to the browser.
 *
 * A server component so the heading, the live-chat panel with its saved values,
 * and the channel panel's own title, description and channel list are in the
 * first HTML rather than behind hydration. The live-chat singleton is one
 * memoized read, so the page waits for it; only the connections query is
 * suspended, and its fallback is the panel's real skeleton, so nothing on the
 * page moves when it resolves.
 */
export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, liveChatSettings] = await Promise.all([
    getTranslations(),
    loadLiveChatSettings(),
  ]);
  const tSafe = (key: string, fallback: string) =>
    t.has(key as never) ? t(key as never) : fallback;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={tSafe("admin.settings.messaging.title", "Omnichannel Messaging")}
        description={tSafe(
          "admin.settings.messaging.description",
          "Live chat hours, escalation, and the WhatsApp, Messenger, Instagram and Telegram accounts the marketplace replies from",
        )}
      />
      <PlatformLiveChatSettingsPanel initialSettings={liveChatSettings} />
      <Suspense fallback={<ChannelConnectionsPanelSkeleton />}>
        <ChannelConnectionsSection />
      </Suspense>
    </div>
  );
}

/**
 * The panel used to mount empty and spin until its own browser fetch
 * answered, on every visit. A failed read here returns nothing, and the panel
 * falls back to fetching for itself — the settings layout's pattern.
 */
async function loadLiveChatSettings() {
  try {
    await connectDB();
    return await getPlatformMessagingConfiguration();
  } catch {
    return undefined;
  }
}
