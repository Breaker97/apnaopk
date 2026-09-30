/**
 * Unsaved settings, for the navigations that are not link clicks.
 *
 * A settings page asks before a link click throws its unsaved edits away
 * (useUnsavedLinkGuard). The dashboard chrome also changes page from code —
 * the header's and the preferences drawer's language switches push — and a
 * push is no click. While settings hold unsaved edits the page registers its
 * check here, and the chrome awaits it before pushing. With no settings page
 * open, or nothing unsaved, everything passes.
 *
 * A module of its own so the admin header, on every admin page, does not
 * pull in the settings form's data layer.
 */
type LeaveCheck = (href: string) => Promise<boolean>;

let check: LeaveCheck | null = null;

export function setSettingsLeaveCheck(next: LeaveCheck | null) {
  check = next;
}

/** Resolves true when it is fine to go to `href`. */
export function confirmLeaveSettings(href: string): Promise<boolean> {
  return check ? check(href) : Promise.resolve(true);
}
