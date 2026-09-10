"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { buildLoginUrl, currentBrowserPath } from "@/lib/auth/return-path";

interface VendorFollowLabels {
  follow: string;
  following: string;
  followed: string;
  unfollowed: string;
  loginRequired: string;
  error: string;
}

interface VendorFollowButtonProps {
  slug: string;
  /** Resolved server-side, so the button never flashes the wrong state. */
  initialIsFollowing: boolean;
  isAuthenticated: boolean;
  locale: string;
  labels: VendorFollowLabels;
  className?: string;
}

/**
 * Follow / Following toggle for a vendor storefront.
 *
 * Optimistic: the label flips immediately and rolls back if the request fails,
 * because a follow is trivially reversible and waiting on a round trip for it
 * feels broken.
 *
 * A signed-out shopper is sent to login with a `callbackUrl` back to this store,
 * rather than being shown a button that silently does nothing.
 */
export function VendorFollowButton({
  slug,
  initialIsFollowing,
  isAuthenticated,
  locale,
  labels,
  className,
}: VendorFollowButtonProps) {
  const router = useRouter();
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isPending, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);

  const handleClick = async () => {
    if (!isAuthenticated) {
      router.push(
        buildLoginUrl(
          locale,
          currentBrowserPath() ?? `/${locale}/vendors/${slug}`,
        ),
      );
      toast.info(labels.loginRequired);
      return;
    }

    const next = !isFollowing;
    // Optimistic flip, rolled back if the request fails.
    setIsFollowing(next);
    setIsSaving(true);

    try {
      const res = await fetch(`/api/vendors/${slug}/follow`, {
        method: next ? "POST" : "DELETE",
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: { isFollowing: boolean };
        message?: string;
      };

      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.message || labels.error);
      }

      // Trust the server's answer over the optimistic guess.
      setIsFollowing(json.data.isFollowing);
      toast.success(next ? labels.followed : labels.unfollowed);

      // Refresh so anything else reading follow state on this page agrees.
      startTransition(() => router.refresh());
    } catch (error) {
      setIsFollowing(!next);
      toast.error(error instanceof Error ? error.message : labels.error);
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isSaving || isPending;

  return (
    <Button
      type="button"
      variant={isFollowing ? "outline" : "default"}
      onClick={handleClick}
      disabled={busy}
      aria-pressed={isFollowing}
      className={cn("h-9 shrink-0", className)}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : isFollowing ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Heart className="h-4 w-4 fill-current" aria-hidden="true" />
      )}
      {isFollowing ? labels.following : labels.follow}
    </Button>
  );
}
