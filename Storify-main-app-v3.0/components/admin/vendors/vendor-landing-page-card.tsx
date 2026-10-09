"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, Loader2 } from "lucide-react";
import Link from "@/components/language/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";

interface LandingPageState {
  slug: string | null;
  published: { publishedAt: string | null; sectionsCount: number } | null;
  takedown: { at: string; reason: string } | null;
}

/**
 * Vendor → Access → Landing page. The Home tab this vendor designed in their
 * Vendor CMS goes live without review; this is where an admin can see it and
 * take it down. Admins cannot edit a vendor's page — unpublishing is the one
 * act, and the vendor can fix the page and publish again.
 */
export function VendorLandingPageCard({
  vendorId,
  readOnly,
}: {
  vendorId: string;
  readOnly?: boolean;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const locale = useLocale();
  const [state, setState] = useState<LandingPageState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiClient
      .get<LandingPageState>(`/api/admin/vendors/${vendorId}/store-page`)
      .then((data) => {
        setState(data);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(value),
        )
      : "";

  const unpublish = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/api/admin/vendors/${vendorId}/store-page`, {
        reason: reason.trim() || undefined,
      });
      toast.success(
        tSafe(
          "admin.vendorLandingPage.unpublished",
          "Landing page unpublished. The store opens on its products again.",
        ),
      );
      setConfirmOpen(false);
      setReason("");
      load();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.storeBuilder.actionFailed", "The action failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {tSafe("admin.vendorLandingPage.title", "Landing page")}
        </CardTitle>
        <CardDescription>
          {tSafe(
            "admin.vendorLandingPage.description",
            "The Home tab this store designed in its Vendor CMS. It goes live when the vendor publishes it; you can take it down, but not edit it.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadFailed ? (
          <p className="text-sm text-muted-foreground">
            {tSafe(
              "admin.vendorLandingPage.loadFailed",
              "The landing page status could not be loaded.",
            )}
          </p>
        ) : !state ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {state.published ? (
                <>
                  <Badge>
                    {tSafe("admin.vendorLandingPage.live", "Published")}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDate(state.published.publishedAt)}
                    {" · "}
                    {tSafe(
                      "admin.vendorLandingPage.sections",
                      "{count} sections",
                      { count: state.published.sectionsCount },
                    )}
                  </span>
                </>
              ) : state.takedown ? (
                <>
                  <Badge variant="destructive">
                    {tSafe(
                      "admin.vendorLandingPage.takenDown",
                      "Unpublished by an admin",
                    )}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDate(state.takedown.at)}
                    {state.takedown.reason ? ` · ${state.takedown.reason}` : ""}
                  </span>
                </>
              ) : (
                <Badge variant="secondary">
                  {tSafe("admin.vendorLandingPage.none", "Not published")}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {state.published && state.slug ? (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link href={`/vendors/${state.slug}`} target="_blank">
                    {tSafe("admin.vendorLandingPage.view", "View store page")}
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
              {state.published && !readOnly ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                >
                  {tSafe("admin.vendorLandingPage.unpublish", "Unpublish")}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tSafe(
                "admin.vendorLandingPage.confirmTitle",
                "Unpublish this landing page?",
              )}
            </DialogTitle>
            <DialogDescription>
              {tSafe(
                "admin.vendorLandingPage.confirmDescription",
                "Shoppers stop seeing it right away. The vendor keeps their draft and sees your reason in their editor.",
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder={tSafe(
              "admin.vendorLandingPage.reasonPlaceholder",
              "Reason for the vendor (optional)",
            )}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              {tSafe("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={unpublish}
              disabled={busy}
              className="gap-1.5"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {tSafe("admin.vendorLandingPage.unpublish", "Unpublish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
