/**
 * The push services a browser subscription can point at: Google's (Chrome,
 * Edge on Android, Samsung Internet, Opera, Brave), Mozilla's, Microsoft's
 * and Apple's.
 *
 * The endpoint is whatever the browser — or anyone calling the API — sent,
 * and the server posts to it every time a notification goes out; an unchecked
 * one had the store's server make requests to any address it was given.
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com"];
const PUSH_SERVICE_DOMAINS = [
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

export function isKnownPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  );
}
