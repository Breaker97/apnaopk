/**
 * Where the Activity Log's words live.
 *
 * An action or a resource is named by a stored value (`TWO_FACTOR_CHANGE`,
 * `commissionInvoice`), and what a person reads is a locale message. The message
 * keys are built here, in one place, from the value — never from a `Record`
 * keyed on the union. A value added to `config/audit.config.ts` without a message
 * must still render (humanized) rather than fail to compile or show a raw key;
 * `tests/activity-log-labels.test.ts` is what insists it gets one.
 *
 * Runtime-free, so the server list view and the client table share it.
 */

export const ACTIVITY_LABELS_NAMESPACE = "admin.activityLogPage";

export const actionLabelKey = (action: string) =>
  `${ACTIVITY_LABELS_NAMESPACE}.actions.${action}`;

export const resourceLabelKey = (resource: string) =>
  `${ACTIVITY_LABELS_NAMESPACE}.resources.${resource}`;

export const roleLabelKey = (role: string) =>
  `${ACTIVITY_LABELS_NAMESPACE}.roles.${role}`;

/**
 * A stored value as a sentence-case phrase: `TWO_FACTOR_CHANGE` → "Two factor
 * change", `commissionInvoice` → "Commission invoice". What an unknown value
 * reads as until someone writes its message.
 */
export function humanizeKey(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Any next-intl translator, namespaced or not; `never` keys let each one be
 * passed without a cast (the same shape `useFallbackTranslator` takes).
 */
type Translator = ((key: never, values?: never) => string) & {
  has: (key: string) => boolean;
};

/** The message at `key`, or the humanized `raw` when there is none. */
export function labelFor(t: Translator, key: string, raw: string): string {
  return t.has(key) ? t(key as never) : humanizeKey(raw);
}
