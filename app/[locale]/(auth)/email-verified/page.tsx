import Link from "next/link";
import { CheckCircle2, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const failed = Boolean(query.error);

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        {failed ? (
          <CircleX className="mx-auto mb-2 h-10 w-10 text-destructive" />
        ) : (
          <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-600" />
        )}
        <CardTitle>{failed ? "Verification link is invalid" : "Email verified"}</CardTitle>
      </CardHeader>
      <CardContent className="text-center text-sm text-muted-foreground">
        {failed
          ? "This link may have expired or already been replaced. Request a new verification email and try again."
          : "Your email address is verified and your account is ready."}
      </CardContent>
      <CardFooter>
        <Button className="w-full" asChild>
          <Link href={failed ? `/${locale}/verify-email` : `/${locale}/role-redirect`}>
            {failed ? "Request another link" : "Continue"}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
