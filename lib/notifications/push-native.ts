/**
 * Native push delivery (iOS / Android).
 *
 * Sends through Expo's push service, which fans out to APNs and FCM on our
 * behalf. That matters for a self-hosted product: the alternative — talking to
 * FCM and APNs directly — makes every buyer register a Firebase project, mint
 * a service account and upload an APNs key before a single notification
 * arrives. Expo needs no server credentials at all; the device's token is the
 * only thing required, and the app supplies that when it registers.
 *
 * Swapping providers means replacing `sendNativePush` — the callers only know
 * about tokens and payloads. If you ship a bare React Native app (no Expo),
 * point this at FCM instead and keep the same signature.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;

export interface NativePushMessage {
  token: string;
  title: string;
  body: string;
  /** Delivered to the app as `data`; used for deep-linking the tap. */
  data?: Record<string, unknown>;
}

interface NativePushTicket {
  token: string;
  ok: boolean;
  /** Set when Expo rejects the token permanently, so we can deactivate it. */
  unregistered?: boolean;
  error?: string;
}

/** Expo tokens look like `ExponentPushToken[xxxxxxxx]` or `ExpoPushToken[...]`. */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function sendNativePush(
  messages: NativePushMessage[],
): Promise<NativePushTicket[]> {
  if (messages.length === 0) return [];

  const tickets: NativePushTicket[] = [];

  for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(
          batch.map((message) => ({
            to: message.token,
            title: message.title,
            body: message.body,
            data: message.data,
            sound: "default",
          })),
        ),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        for (const message of batch) {
          tickets.push({
            token: message.token,
            ok: false,
            error: `Expo responded ${response.status}: ${text.slice(0, 200)}`,
          });
        }
        continue;
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const results = Array.isArray(payload.data) ? payload.data : [];

      batch.forEach((message, index) => {
        const ticket = results[index];
        if (ticket?.status === "ok") {
          tickets.push({ token: message.token, ok: true });
          return;
        }
        tickets.push({
          token: message.token,
          ok: false,
          // Expo reports a token the user has uninstalled or revoked as
          // DeviceNotRegistered; that one is permanent, so the caller should
          // stop sending to it rather than retry forever.
          unregistered: ticket?.details?.error === "DeviceNotRegistered",
          error: ticket?.message || ticket?.details?.error || "Push rejected",
        });
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Native push request failed";
      for (const item of batch) {
        tickets.push({ token: item.token, ok: false, error: message });
      }
    }
  }

  return tickets;
}
