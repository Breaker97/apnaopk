"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, Loader2, ArrowLeft, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { z } from "zod";

const ResetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

function ResetPasswordContent() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = params.locale as string;
  const token = searchParams.get("token");

  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  // Validate token on mount
  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setIsValidating(false);
        setIsValidToken(false);
        return;
      }

      try {
        const response = await fetch(`/api/auth/reset-password?token=${token}`);
        const result = await response.json();
        setIsValidToken(result.valid);
      } catch {
        setIsValidToken(false);
      } finally {
        setIsValidating(false);
      }
    }

    validateToken();
  }, [token]);

  const onSubmit = async (data: ResetPasswordInput) => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setError(`Too many attempts. Please request a new reset link.`);
        } else {
          setError(result.message || "An error occurred");
        }
        return;
      }

      setSuccess(true);
      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push(`/${locale}/login`);
      }, 3000);
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (isValidating) {
    return (
      <Card className="shadow-lg">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Validating reset link...</p>
        </CardContent>
      </Card>
    );
  }

  // Invalid or missing token
  if (!token || !isValidToken) {
    return (
      <Card className="shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-2">
            <XCircle className="h-12 w-12 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {t("auth.invalidResetLink")}
          </CardTitle>
          <CardDescription>
            {t("auth.invalidResetLinkDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-4">
          <Button className="w-full" asChild>
            <Link href={`/${locale}/forgot-password`}>
              {t("auth.requestNewLink")}
            </Link>
          </Button>
          <Button variant="link" className="w-full" asChild>
            <Link href={`/${locale}/login`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("auth.backToLogin")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Success state
  if (success) {
    return (
      <Card className="shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-2">
            <CheckCircle className="h-12 w-12 text-green-500" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {t("auth.passwordResetSuccess")}
          </CardTitle>
          <CardDescription>
            {t("auth.passwordResetSuccessDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button className="w-full" asChild>
            <Link href={`/${locale}/login`}>
              {t("auth.goToLogin")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold">
          {t("auth.resetPassword")}
        </CardTitle>
        <CardDescription>
          {t("auth.resetPasswordDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {error}
              </div>
            )}

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("auth.newPassword")}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        {...field}
                        type="password"
                        placeholder="••••••••"
                        className="pl-10"
                        disabled={isLoading}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("auth.confirmPassword")}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        {...field}
                        type="password"
                        placeholder="••••••••"
                        className="pl-10"
                        disabled={isLoading}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("common.loading")}
                </>
              ) : (
                t("auth.resetPassword")
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter>
        <Button variant="link" className="w-full" asChild>
          <Link href={`/${locale}/login`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("auth.backToLogin")}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ResetPasswordFallback() {
  return (
    <Card className="shadow-lg">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Loading...</p>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
