/**
 * The VAPID keys browser push is signed with. They live in the environment
 * only, so the settings page cannot set them; it can only be told whether
 * they are there (`_meta.webPush`). Kept apart from push-notifications.ts so
 * that question does not load the push sender.
 */

export function getVapidPublicKey() {
  return (
    process.env.WEB_PUSH_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ||
    ""
  ).trim();
}

export function getVapidPrivateKey() {
  return (process.env.WEB_PUSH_PRIVATE_KEY || "").trim();
}

/** Both keys are set, so browser push can be signed and sent. */
export function isWebPushConfigured() {
  return Boolean(getVapidPublicKey() && getVapidPrivateKey());
}
