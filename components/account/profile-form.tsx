"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { authClient } from "@/lib/auth/auth-client";
import {
  DEFAULT_PROFILE_DEMO_MODE,
  normalizeDemoModeState,
} from "@/lib/demo-mode-shared";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  birthday: z.string().optional(),
  gender: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export function ProfileForm() {
  const t = useTranslations();
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [demoMode, setDemoMode] = useState(DEFAULT_PROFILE_DEMO_MODE);
  const isDemoMode = demoMode.enabled;

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      birthday: "",
      gender: "",
    },
  });

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch("/api/user/profile");
        const json = await res.json();
        const user = json?.data?.user;

        if (!res.ok || !json?.success || !user) {
          throw new Error(json?.error || json?.message || "Failed to load");
        }

        const loadedDemoMode = json?.data?.demoMode;
        setDemoMode(normalizeDemoModeState(loadedDemoMode));

        const nameParts = (user.name || "").split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";

        profileForm.reset({
          firstName,
          lastName,
          email: user.email || "",
          phone: user.phone || "",
          birthday: user.birthday || "",
          gender: user.gender || "",
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load profile",
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchProfile();
  }, [profileForm]);

  const onProfileSubmit = async (data: ProfileFormData) => {
    if (isDemoMode) {
      toast.error(demoMode.message);
      return;
    }

    setIsSaving(true);
    try {
      const fullName = `${data.firstName} ${data.lastName}`.trim();

      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fullName,
          phone: data.phone,
          birthday: data.birthday,
          gender: data.gender,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        const errors = json?.errors as Record<string, string[]> | undefined;
        if (errors?.name?.[0]) {
          profileForm.setError("firstName", {
            type: "server",
            message: errors.name[0],
          });
        }
        if (errors?.phone?.[0]) {
          profileForm.setError("phone", {
            type: "server",
            message: errors.phone[0],
          });
        }
        if (errors?.birthday?.[0]) {
          profileForm.setError("birthday", {
            type: "server",
            message: errors.birthday[0],
          });
        }
        if (errors?.gender?.[0]) {
          profileForm.setError("gender", {
            type: "server",
            message: errors.gender[0],
          });
        }
        throw new Error(json?.error || json?.message || t("common.error"));
      }

      await authClient.updateUser({ name: fullName }).catch(() => null);

      profileForm.reset(data);
      toast.success(json?.message || t("common.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {isDemoMode && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 text-sm leading-5 text-amber-800 dark:text-amber-200">
            {demoMode.message}
          </p>
        </div>
      )}

      {/* Personal Information */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>
            {t("profile.personal")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...profileForm}>
            <form
              id="customer-profile-form"
              onSubmit={profileForm.handleSubmit(onProfileSubmit)}
              className="space-y-6"
            >
              <fieldset
                disabled={isDemoMode || isSaving}
                className="space-y-6"
              >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={profileForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-medium">
                        {t("profile.firstName")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="given-name"
                          className="h-11 bg-background/50 focus:bg-background transition-colors"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-medium">
                        {t("profile.lastName")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="family-name"
                          className="h-11 bg-background/50 focus:bg-background transition-colors"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-medium">
                        {t("profile.email")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="email"
                          disabled
                          className="h-11 bg-muted"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-medium">
                        {t("profile.phone")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="tel"
                          autoComplete="tel"
                          inputMode="tel"
                          className="h-11 bg-background/50 focus:bg-background transition-colors"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="birthday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-medium">
                        {t("profile.birthday")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type="date"
                            autoComplete="bday"
                            className="h-11 bg-background/50 focus:bg-background transition-colors block w-full"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-medium">
                        {t("profile.gender")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isDemoMode || isSaving}
                      >
                        <FormControl>
                          <SelectTrigger className="h-11 bg-background/50 focus:bg-background transition-colors">
                            <SelectValue
                              placeholder={t("profile.selectGender")}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="male">
                            {t("profile.male")}
                          </SelectItem>
                          <SelectItem value="female">
                            {t("profile.female")}
                          </SelectItem>
                          <SelectItem value="other">
                            {t("profile.other")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              </fieldset>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Link
        href={`/${locale}/account/security`}
        aria-label={t("account.security")}
        className="flex min-h-11 items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent"
      >
        <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t("account.security")}</span>
          <span className="block text-sm text-muted-foreground">
            {t("account.securityDescription")}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>

      {profileForm.formState.isDirty && (
        <div className="fixed inset-x-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur bottom-[calc(3.75rem+env(safe-area-inset-bottom))] lg:static lg:flex lg:justify-end lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <Button
            type="submit"
            form="customer-profile-form"
            disabled={isDemoMode || isSaving}
            className="h-11 w-full lg:w-auto"
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("profile.saveChanges")}
          </Button>
        </div>
      )}
    </div>
  );
}
