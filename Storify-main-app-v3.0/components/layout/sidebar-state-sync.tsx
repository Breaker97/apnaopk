"use client";

import { useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAppSettings } from "@/stores/app-settings";

/**
 * SidebarStateSync
 * Keeps the dashboard sidebar and the "Collapsed sidebar" preference in sync,
 * in both directions:
 *  - Toggling the preference (Preferences drawer) collapses/expands the sidebar.
 *  - Clicking the sidebar trigger / pressing the keyboard shortcut updates the
 *    preference so the drawer toggle stays accurate.
 *
 * A single effect reconciles whichever side changed, using refs to detect the
 * source of the change. This avoids the previous bug where a manual toggle from
 * the sidebar trigger was immediately reverted (the context `setOpen` changes
 * identity on every `open` change, which re-ran the old apply-from-preference
 * effect).
 *
 * Must be rendered inside a <SidebarProvider>.
 */
export function SidebarStateSync() {
  const collapsedSidebar = useAppSettings((s) => s.collapsedSidebar);
  const setCollapsedSidebar = useAppSettings((s) => s.setCollapsedSidebar);
  const { open, setOpen, isMobile } = useSidebar();

  const prevCollapsed = useRef(collapsedSidebar);
  const prevOpen = useRef(open);
  const initialized = useRef(false);

  useEffect(() => {
    // On mobile the sidebar uses its own off-canvas sheet, so leave it alone.
    if (isMobile) return;

    // First run: the stored preference is the source of truth, so apply it to
    // the sidebar (e.g. a persisted "collapsed" preference on page load).
    if (!initialized.current) {
      initialized.current = true;
      if (open !== !collapsedSidebar) setOpen(!collapsedSidebar);
      prevCollapsed.current = collapsedSidebar;
      prevOpen.current = !collapsedSidebar;
      return;
    }

    const collapsedChanged = prevCollapsed.current !== collapsedSidebar;
    const openChanged = prevOpen.current !== open;

    if (collapsedChanged) {
      // Preference changed (drawer toggle) -> drive the sidebar.
      if (open !== !collapsedSidebar) setOpen(!collapsedSidebar);
    } else if (openChanged) {
      // Sidebar toggled by the trigger / keyboard shortcut -> update preference.
      if (collapsedSidebar !== !open) setCollapsedSidebar(!open);
    }

    prevCollapsed.current = collapsedSidebar;
    prevOpen.current = open;
  }, [collapsedSidebar, open, isMobile, setOpen, setCollapsedSidebar]);

  return null;
}
