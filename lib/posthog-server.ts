import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

/**
 * Server-side PostHog, or null when NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is not
 * set — analytics is optional, and a store without a token sends nothing.
 */
export function getPostHogClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return null;
  if (!posthogClient) {
    posthogClient = new PostHog(token, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}
