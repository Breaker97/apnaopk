"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
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
import { toast } from "@/components/ui/toast-notification";
import { WarningBanner } from "@/components/ui/warning-banner";
import { authClient } from "@/lib/auth/auth-client";
import { normalizeDemoModeState } from "@/lib/demo-mode-shared";
import { useSuspenseResource } from "@/hooks/use-suspense-resource";
import {
  USER_PROFILE_URL,
  type UserProfilePayload,
} from "@/components/account/user-profile-resource";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  birthday: z.string().optional(),
  gender: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

function profileFormValues(user: UserProfilePayload["user"]): ProfileFormData {
  const nameParts = (user?.name || "").split(" ");
  return {
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
    email: user?.email || "",
    phone: user?.phone || "",
    birthday: user?.birthday || "",
    gender: user?.gender || "",
  };
}

/**
 * Suspends until the profile is known — render it inside `<ClientSuspense>`,
 * whose fallback is the loading state. A later visit fills the form from the
 * held copy without asking again (see `useSuspenseResource`).
 */
export function ProfileForm() {
  const t = useTranslations();
  const {
    data: profile,
    error: loadError,
    mutate: mutateProfile,
  } = useSuspenseResource<UserProfilePayload>(USER_PROFILE_URL);
  const [isSaving, setIsSaving] = useState(false);
  const demoMode = normalizeDemoModeState(profile?.demoMode);
  const isDemoMode = demoMode.enabled;

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    // Read once, on mount: a background refresh of the held profile must not
    // wipe what the shopper is typing.
    defaultValues: profileFormValues(profile?.user),
  });

  const loadFailure = loadError
    ? loadError.message || "Failed to load profile"
    : profile?.user
      ? null
      : "Failed to load";
  useEffect(() => {
    if (loadFailure) toast.error(loadFailure, { id: "profile-load-error" });
  }, [loadFailure]);

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

      // The held copy is what the next visit fills the form from.
      mutateProfile((current) => ({
        ...current,
        user: current.user
          ? {
              ...current.user,
              name: fullName,
              phone: data.phone,
              birthday: data.birthday,
              gender: data.gender,
            }
          : current.user,
      }));
      profileForm.reset(data);
      toast.success(json?.message || t("common.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {isDemoMode && (
        <WarningBanner icon={LockKeyhole} className="shadow-sm">
          {demoMode.message}
        </WarningBanner>
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
        href="/account/security"
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
