"use client";

/**
 * A leave guard for a long form or editor: while it has unsaved changes,
 * leaving asks first.
 *
 * - A reload, a closed tab or another site: `beforeunload`.
 * - A link within the app — a toolbar's Back, the admin sidebar, the
 *   header — is caught on `window` in the capture phase, ahead of the
 *   router, and goes ahead only after "Leave" in a confirmation dialog.
 * - The dashboard chrome's language switches push from code; they ask
 *   through the shared leave check (`confirmLeaveSettings`), which this
 *   registers while the edits are unsaved.
 * - A Back that is a button (`router.back()`) is no link: it asks through
 *   the `requestLeave` this returns.
 *
 * The browser's own Back and Forward can't be stopped by a page; a local
 * draft copy (use-local-draft.ts, the invoice editor's use-draft-recovery.ts)
 * is what saves those edits. Navigations the form starts itself (after Save)
 * are pushes from code and pass.
 *
 * `onLeave` hears that the user is on the way out, whether or not anything
 * was unsaved: a confirmed Leave, any in-app navigation the app's links
 * announce (navigation-progress.tsx), the browser's Back or Forward. The
 * invoice editor uses it so a save that answers afterwards doesn't pull the
 * user back in (review L10).
 *
 * The same approach as the settings pages' `useUnsavedChangesGuard`.
 */
import { useCallback, useEffect, useEffectEvent } from "react";
import { setSettingsLeaveCheck } from "@/components/admin/settings/settings-leave-check";
import { startNavigationProgress } from "@/components/layout/navigation-progress";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useRouter } from "@/hooks/use-locale-navigation";

export interface LeaveGuardText {
  title: string;
  description: string;
  confirm: string;
  cancel: string;
}

/** What `startNavigationProgress` (components/layout/navigation-progress.tsx) announces on `window`. */
const NAVIGATION_START_EVENT = "storify:navigation-start";

export function useLeaveGuard(unsaved: boolean, text: LeaveGuardText, { onLeave }: { onLeave?: () => void } = {}) {
  const { confirm } = useConfirmation();
  const router = useRouter();

  const left = useEffectEvent(() => onLeave?.());

  const { title, description, confirm: confirmText, cancel: cancelText } = text;
  const askToLeave = useCallback(
    async (): Promise<boolean> =>
      !unsaved ||
      confirm({
        title,
        description,
        confirmText,
        cancelText,
        type: "warning",
        confirmVariant: "destructive",
      }),
    [unsaved, confirm, title, description, confirmText, cancelText],
  );

  const confirmLeave = useEffectEvent(() => askToLeave());

  const onClick = useEffectEvent((event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) {
      return;
    }
    const url = new URL(anchor.href, window.location.href);
    // Another site is a full page load, which `beforeunload` asks about; the same page (or only its hash) loses nothing.
    if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) {
      return;
    }
    event.preventDefault();
    if (anchor.closest('[role="menu"]')) {
      // A menu closes on an item's click only when that click isn't prevented.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    const destination = `${url.pathname}${url.search}${url.hash}`;
    void confirmLeave().then((ok) => {
      if (!ok) return;
      left();
      startNavigationProgress();
      router.push(destination);
    });
  });

  useEffect(() => {
    const onNavigate = () => left();
    window.addEventListener(NAVIGATION_START_EVENT, onNavigate);
    window.addEventListener("popstate", onNavigate);
    return () => {
      window.removeEventListener(NAVIGATION_START_EVENT, onNavigate);
      window.removeEventListener("popstate", onNavigate);
    };
  }, []);

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    setSettingsLeaveCheck(async () => {
      const ok = await confirmLeave();
      if (ok) left();
      return ok;
    });
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
      setSettingsLeaveCheck(null);
    };
  }, [unsaved]);

  // For a Back that is a button: resolves true when it is fine to go (nothing
  // unsaved, or "Leave"). It doesn't announce `onLeave`; the caller that
  // needs it is the invoice editor, whose Back is a link.
  return askToLeave;
}
