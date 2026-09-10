"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function VerifyEmailPanel({ email, locale }: { email: string; locale: string }) {
  const [address, setAddress] = useState(email);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const resend = async () => {
    if (!address) return;
    setIsSending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: address,
          callbackURL: `/${locale}/email-verified`,
        }),
      });
      if (!response.ok) throw new Error();
      setMessage("A fresh verification link has been sent if this account still needs verification.");
    } catch {
      setMessage("We could not send another link right now. Please try again shortly.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <MailCheck className="mx-auto mb-2 h-10 w-10 text-primary" />
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent a verification link{address ? <> to <strong>{address}</strong></> : " to your email address"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-center text-sm text-muted-foreground">
        <p>Open the link to verify your email and activate your account. The link expires in 24 hours.</p>
        <Input
          type="email"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
        />
        {message && <p className="rounded-md bg-muted p-3 text-foreground">{message}</p>}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button className="w-full" type="button" onClick={() => void resend()} disabled={isSending || !address}>
          {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Resend verification email
        </Button>
        <Button className="w-full" variant="outline" asChild>
          <Link href={`/${locale}/login`}>Back to sign in</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
