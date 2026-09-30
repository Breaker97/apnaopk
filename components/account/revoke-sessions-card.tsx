"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, RefreshCw } from "lucide-react";

/**
 * "Sign out of all other sessions" on the account Security page. Lives apart
 * from the page so the page itself can render on the server.
 */
export function RevokeSessionsCard() {
  const t = useTranslations();

  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleRevokeSessions = async () => {
    setIsRevoking(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/auth/revoke-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeAll: true, excludeCurrent: true }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          data.message ||
            t("account.revokeSessionsFailed"),
        );
        return;
      }

      setSuccess(
        data.message ||
          t("account.revokeSessionsSuccess"),
      );
    } catch {
      setError(
        t("account.genericTryAgain"),
      );
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-muted rounded-lg">
            <RefreshCw className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-lg">
              {t("account.activeSessions")}
            </CardTitle>
            <CardDescription>
              {t("account.activeSessionsDescription")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {success && (
          <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <span className="text-green-700 dark:text-green-400">
              {success}
            </span>
          </div>
        )}
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3">
            <XCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">{error}</span>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {t("account.currentSessionInfo")}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={handleRevokeSessions}
          disabled={isRevoking}
        >
          {isRevoking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common.loading")}
            </>
          ) : (
            t("account.signOutAllSessions")
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
