"use client";

import { useSyncExternalStore } from "react";
import type { AdminSettingsSectionId } from "./settings-sections";

/**
 * What the settings menu in the dashboard sidebar marks beside a section:
 * edits not saved yet, and a feature switched on without what it needs (a
 * gateway with no key, SMTP with no host, maintenance mode on).
 *
 * Only `AdminSettingsProvider` knows either, and it lives in the settings
 * layout — below the admin layout that draws the sidebar, so the menu cannot
 * read it. `SettingsShell` publishes both here while a settings page is open
 * and clears them when it closes.
 */
type SettingsNavStatus = {
  dirty: ReadonlySet<AdminSettingsSectionId>;
  attention: ReadonlySet<AdminSettingsSectionId>;
};

const EMPTY_STATUS: SettingsNavStatus = {
  dirty: new Set(),
  attention: new Set(),
};

let current = EMPTY_STATUS;
const listeners = new Set<() => void>();

const sameMembers = (
  a: ReadonlySet<AdminSettingsSectionId>,
  b: ReadonlySet<AdminSettingsSectionId>,
) => a.size === b.size && [...a].every((id) => b.has(id));

export function publishSettingsNavStatus(next: SettingsNavStatus | null) {
  const status = next ?? EMPTY_STATUS;
  // Settings re-render on every keystroke; the menu only needs to hear about
  // a section changing state.
  if (
    sameMembers(status.dirty, current.dirty) &&
    sameMembers(status.attention, current.attention)
  ) {
    return;
  }
  current = status;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettingsNavStatus(): SettingsNavStatus {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY_STATUS,
  );
}
