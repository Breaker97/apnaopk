"use client";

import { useEffect, useEffectEvent } from "react";
import { useTranslations } from "next-intl";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { startNavigationProgress } from "@/components/layout/navigation-progress";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { splitLocalePath } from "@/lib/i18n/locale-prefix";
import { adminSettingsSectionFromPath } from "./settings-sections";
import { setSettingsLeaveCheck } from "./settings-leave-check";

const isSettingsPage = (pathname: string) =>
  adminSettingsSectionFromPath(splitLocalePath(pathname).rest) !== null;

/**
 * Asks before unsaved settings are thrown away, however the page is left: a
 * reload, a closed tab or another site (`beforeunload`), a link within the
 * app, and the dashboard chrome's language switches.
 *
 * `AdminSettingsProvider` runs it, so it covers every screen that edits the
 * settings, not just the settings pages. Vendors → Configuration and the
 * Themes page's Branding tab hold the same drafts outside the settings shell,
 * and leaving them used to drop the edits without a word.
 *
 * Browser Back and Forward cannot be stopped by the page. Between settings
 * pages the drafts ride along (the layout stays mounted) and keep their
 * "Unsaved" mark; out of the screen they go.
 */
export function useUnsavedChangesGuard(
  unsaved: boolean,
  /** Back to the saved copy, for a move to another settings page. */
  discardEdits: () => void,
) {
  const confirmLeave = useConfirmLeave(unsaved, discardEdits);

  // A reload, a closed tab, or a link to another site.
  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);

  // A link within the app, which `beforeunload` never hears about.
  useUnsavedLinkGuard(unsaved, confirmLeave);
}

/**
 * Asks before unsaved settings are thrown away. Resolves true when it is fine
 * to go on to `href`: nothing was unsaved, or the admin chose to discard it.
 */
function useConfirmLeave(unsaved: boolean, discardEdits: () => void) {
  const t = useTranslations();
  const { confirm } = useConfirmation();

  const tSafe = useFallbackTranslator(t);

  return async (href: string): Promise<boolean> => {
    if (!unsaved) return true;
    const ok = await confirm({
      title: tSafe("admin.settings.unsavedChanges.title", "Unsaved changes"),
      description: tSafe(
        "admin.settings.unsavedChanges.description",
        "Discard your unsaved changes and switch sections?",
      ),
      confirmText: tSafe("admin.settings.unsavedChanges.confirm", "Discard"),
      cancelText: tSafe("admin.settings.unsavedChanges.cancel", "Stay"),
      type: "danger",
      confirmVariant: "destructive",
    });
    if (!ok) return false;
    // The settings layout, drafts and all, outlives a move between settings
    // pages, so the drafts go back to the saved values first. Any other move
    // unmounts the screen holding them, which discards them anyway.
    const { pathname } = new URL(href, window.location.href);
    if (isSettingsPage(window.location.pathname) && isSettingsPage(pathname)) {
      discardEdits();
    }
    return true;
  };
}

/**
 * While settings are unsaved, sends every in-app link click through
 * `useConfirmLeave`: the settings menu, Back to dashboard, and the dashboard
 * header, which stays on screen beside settings. A link followed client-side
 * never fires `beforeunload`, so without this those edits were lost silently.
 *
 * Listens on `window` in the capture phase, ahead of React's listener on the
 * document, and cancels the click's default: a Link does not navigate a click
 * whose default is prevented. The click itself still reaches React, so the
 * link's own handlers run — the search dialog and the mobile sidebar close
 * themselves as they would on any pick.
 *
 * Navigations started from code (`router.push`) are no click. The dashboard
 * chrome's own — its language switches — ask through `confirmLeaveSettings`,
 * which this registers for as long as the edits are unsaved.
 */
function useUnsavedLinkGuard(
  enabled: boolean,
  confirmLeave: (href: string) => Promise<boolean>,
) {
  const router = useRouter();

  const onClick = useEffectEvent((event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor =
      event.target instanceof Element
        ? event.target.closest("a[href]")
        : null;
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    ) {
      return;
    }
    const url = new URL(anchor.href);
    // Another site is a full page load, which `beforeunload` already asks
    // about; the same page, or only its hash, loses nothing.
    if (
      url.origin !== window.location.origin ||
      (url.pathname === window.location.pathname &&
        url.search === window.location.search)
    ) {
      return;
    }

    event.preventDefault();
    // A menu (the header's profile menu) is the exception: it closes on an
    // item's click only when that click is not prevented, so it would stay
    // open under the prompt, and on the next page. Close it as Escape does.
    if (anchor.closest('[role="menu"]')) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    }
    const destination = `${url.pathname}${url.search}${url.hash}`;
    void confirmLeave(destination).then((ok) => {
      if (!ok) return;
      startNavigationProgress();
      router.push(destination);
    });
  });

  const leaveCheck = useEffectEvent((href: string) => confirmLeave(href));

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("click", onClick, true);
    setSettingsLeaveCheck((href) => leaveCheck(href));
    return () => {
      window.removeEventListener("click", onClick, true);
      setSettingsLeaveCheck(null);
    };
  }, [enabled]);
}
