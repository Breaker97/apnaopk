"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Loader2,
  Eye,
  EyeOff,
  Camera,
  Mail,
  Phone,
  Calendar,
  User,
  Shield,
  KeyRound,
  Check,
  LockKeyhole,
} from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { authClient } from "@/lib/auth/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { TwoFactorManagementCard } from "@/components/account/two-factor-management-card";
import {
  DEFAULT_PROFILE_DEMO_MODE,
  normalizeDemoModeState,
} from "@/lib/demo-mode-shared";
import { apiClient, ApiClientError } from "@/lib/api/client";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  birthday: z.string().optional(),
  gender: z.string().optional(),
});

const passwordSchema = z
  .object({
    oldPassword: z.string().optional(),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

interface UserProfile {
  name: string;
  email: string;
  image?: string;
  phone?: string;
  birthday?: string;
  gender?: string;
  twoFactorEnabled?: boolean;
}

interface AdminProfileContentProps {
  allowEmailEdit?: boolean;
}

export function AdminProfileContent({
  allowEmailEdit = false,
}: AdminProfileContentProps) {
  const t = useTranslations();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [demoMode, setDemoMode] = useState(DEFAULT_PROFILE_DEMO_MODE);
  const avatarInputRef = useRef<HTMLInputElement>(null);
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

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    async function fetchProfile() {
      try {
        const data = await apiClient.get<{
          user?: UserProfile;
          demoMode?: unknown;
        }>("/api/user/profile");
        const userData = data?.user;
        if (!userData) {
          throw new Error("Failed to load");
        }
        const loadedDemoMode = data?.demoMode;
        setDemoMode(normalizeDemoModeState(loadedDemoMode));
        setUser(userData);
        const nameParts = (userData.name || "").split(" ");
        profileForm.reset({
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          email: userData.email || "",
          phone: userData.phone || "",
          birthday: userData.birthday || "",
          gender: userData.gender || "",
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load profile"
        );
      } finally {
        setIsLoading(false);
      }
    }
    fetchProfile();
  }, [profileForm]);

  const handleAvatarUpload = async (fileList: FileList | null) => {
    if (isDemoMode) {
      toast.error(demoMode.message);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }
    const file = fileList?.[0];
    if (!file) return;
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
    if (!file.type.startsWith("image/")) {
      toast.error(`"${file.name}" is not an image file. Please select an image.`);
      return;
    }
    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("files", file);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const uploadJson = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok || !uploadJson?.success) {
        // Surface the server's exact reason (size limit, disallowed type,
        // storage misconfiguration, …) instead of a generic failure.
        const serverError =
          Array.isArray(uploadJson?.errors) && uploadJson.errors.length > 0
            ? uploadJson.errors.join(", ")
            : uploadJson?.message;
        throw new Error(
          serverError || `Upload failed for ${file.name} (${fileSizeMB}MB)`,
        );
      }
      const items = Array.isArray(uploadJson.data) ? uploadJson.data : [];
      const url = items[0]?.url;
      if (!url) {
        throw new Error("Upload succeeded but no file URL was returned");
      }

      await apiClient.put("/api/user/profile", { image: url });

      await authClient.updateUser({ image: url }).catch(() => null);
      setUser((prev) => (prev ? { ...prev, image: url } : prev));
      toast.success(t("adminProfile.avatarUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("adminProfile.avatarError"),
      );
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const onProfileSubmit = async (data: ProfileFormData) => {
    if (isDemoMode) {
      toast.error(demoMode.message);
      return;
    }
    setIsSaving(true);
    try {
      const fullName = `${data.firstName} ${data.lastName}`.trim();
      const email = data.email.trim().toLowerCase();
      let result: { user?: Partial<UserProfile> } | undefined;
      try {
        result = await apiClient.put<{ user?: Partial<UserProfile> }>(
          "/api/user/profile",
          {
            name: fullName,
            ...(allowEmailEdit ? { email } : {}),
            phone: data.phone,
            birthday: data.birthday,
            gender: data.gender,
          },
        );
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.errors?.name?.[0]) {
            profileForm.setError("firstName", {
              type: "server",
              message: error.errors.name[0],
            });
          }
          if (error.errors?.email?.[0]) {
            profileForm.setError("email", {
              type: "server",
              message: error.errors.email[0],
            });
          }
          if (error.code === "CONFLICT") {
            profileForm.setError("email", {
              type: "server",
              message: error.message || t("profile.emailInUse"),
            });
          }
        }
        throw error;
      }
      const updatedUser = result?.user;
      await authClient.updateUser({ name: fullName }).catch(() => null);
      setUser((prev) =>
        prev
          ? {
              ...prev,
              ...updatedUser,
              name: updatedUser?.name || fullName,
              email: updatedUser?.email || (allowEmailEdit ? email : prev.email),
              phone: updatedUser?.phone ?? data.phone,
              birthday: updatedUser?.birthday ?? data.birthday,
              gender: updatedUser?.gender ?? data.gender,
            }
          : prev,
      );
      profileForm.reset({
        ...data,
        email: updatedUser?.email || email,
      });
      router.refresh();
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setIsSaving(false);
    }
  };

  const onPasswordSubmit = async (data: PasswordFormData) => {
    if (isDemoMode) {
      toast.error(demoMode.message);
      return;
    }
    setIsChangingPassword(true);
    try {
      const currentPassword = data.oldPassword?.trim();
      try {
        const result = await apiClient.request<unknown>(
          "POST",
          "/api/user/change-password",
          {
            currentPassword:
              currentPassword && currentPassword.length > 0
                ? currentPassword
                : undefined,
            newPassword: data.newPassword,
          },
        );
        toast.success(result.message || "Password changed successfully");
        passwordForm.reset();
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.errors?.currentPassword?.[0]) {
            passwordForm.setError("oldPassword", {
              type: "server",
              message: error.errors.currentPassword[0],
            });
          }
          if (error.errors?.newPassword?.[0]) {
            passwordForm.setError("newPassword", {
              type: "server",
              message: error.errors.newPassword[0],
            });
          }
        }
        throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl md:col-span-2" />
          <Skeleton className="h-72 rounded-2xl md:col-span-2" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <AdminFormStickyHeader
        title={t("adminProfile.title")}
        description={t("adminProfile.subtitle")}
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        actions={
          <>
            <Button
              type="submit"
              form="staff-profile-form"
              size="sm"
              disabled={isDemoMode || isSaving}
            >
              {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("profile.saveChanges")}
            </Button>
            <Button
              type="submit"
              form="staff-password-form"
              variant="outline"
              size="sm"
              disabled={isDemoMode || isChangingPassword}
              className="shrink-0"
              aria-label={t("adminProfile.updatePassword")}
              aria-busy={isChangingPassword}
            >
              {isChangingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {t("adminProfile.updatePassword")}
              </span>
            </Button>
          </>
        }
      />

      {isDemoMode && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-5">Demo mode</p>
            <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
              {demoMode.message}
            </p>
          </div>
        </div>
      )}

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Avatar Card - Tall left card */}
        <div className="rounded-2xl border bg-card p-6 flex flex-col items-center justify-center text-center space-y-5 shadow-sm">
          <div className="relative group">
            <Avatar className="h-28 w-28 border-4 border-background shadow-lg">
              <AvatarImage src={user?.image} alt={user?.name} />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {getInitials(user?.name || "U")}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={isDemoMode || isUploadingAvatar}
              className="absolute inset-0 rounded-full bg-black/40 opacity-0 transition-opacity flex items-center justify-center cursor-pointer group-hover:opacity-100 disabled:cursor-not-allowed group-hover:disabled:opacity-50"
            >
              {isUploadingAvatar ? (
                <Loader2 className="h-6 w-6 text-white animate-spin" />
              ) : (
                <Camera className="h-6 w-6 text-white" />
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleAvatarUpload(e.target.files)}
              className="hidden"
            />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{user?.name}</h2>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
          <Badge variant="secondary" className="px-3 py-1 text-xs font-medium">
            <Shield className="h-3 w-3 mr-1.5" />
            {t("adminProfile.administrator")}
          </Badge>
          {user?.twoFactorEnabled && (
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" />
              {t("adminProfile.twoFactorActive")}
            </div>
          )}
        </div>

        {/* Personal Info Card - Takes 2 columns */}
        <div className="rounded-2xl border bg-card p-6 shadow-sm md:col-span-2">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">
                {t("adminProfile.personalInfo")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("adminProfile.personalInfoDesc")}
              </p>
            </div>
          </div>

          <Form {...profileForm}>
            <form
              id="staff-profile-form"
              onSubmit={profileForm.handleSubmit(onProfileSubmit)}
              className="space-y-5"
            >
              <fieldset disabled={isDemoMode} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={profileForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("profile.firstName")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} className="h-11 pl-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors" />
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                        </div>
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
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("profile.lastName")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} className="h-11 pl-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors" />
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {allowEmailEdit ? (
                  <FormField
                    control={profileForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {t("profile.email")}
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              {...field}
                              type="email"
                              className="h-11 pl-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors"
                            />
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                <FormField
                  control={profileForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("profile.phone")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="tel" className="h-11 pl-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors" />
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                        </div>
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
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("profile.birthday")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="date" className="h-11 pl-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors" />
                          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={profileForm.control}
                name="gender"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t("profile.gender")}
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isDemoMode}
                    >
                      <FormControl>
                        <SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors">
                          <SelectValue placeholder={t("profile.selectGender")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="male">{t("profile.male")}</SelectItem>
                        <SelectItem value="female">{t("profile.female")}</SelectItem>
                        <SelectItem value="other">{t("profile.other")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </fieldset>
            </form>
          </Form>
        </div>

        {/* Password Card - Takes 2 columns */}
        <div className="rounded-2xl border bg-card p-6 shadow-sm md:col-span-2">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <h3 className="font-semibold">
                {t("profile.changePassword")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("adminProfile.passwordDesc")}
              </p>
            </div>
          </div>

          <Form {...passwordForm}>
            <form
              id="staff-password-form"
              onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
              className="space-y-4"
            >
              <fieldset disabled={isDemoMode} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField
                  control={passwordForm.control}
                  name="oldPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("profile.oldPassword")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showOldPassword ? "text" : "password"}
                            className="h-11 pr-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full hover:bg-transparent"
                            onClick={() => setShowOldPassword(!showOldPassword)}
                          >
                            {showOldPassword ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("profile.newPassword")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showNewPassword ? "text" : "password"}
                            className="h-11 pr-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full hover:bg-transparent"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                          >
                            {showNewPassword ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("profile.confirmPassword")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showConfirmPassword ? "text" : "password"}
                            className="h-11 pr-10 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full hover:bg-transparent"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              </fieldset>
            </form>
          </Form>
        </div>

        {/* Account Info Card - Single column */}
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Mail className="h-5 w-5 text-blue-500" />
            </div>
            <h3 className="font-semibold">
              {t("adminProfile.accountInfo")}
            </h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("profile.email")}</p>
                <p className="text-sm font-medium truncate">{user?.email}</p>
              </div>
            </div>
            {user?.phone && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("profile.phone")}</p>
                  <p className="text-sm font-medium">{user.phone}</p>
                </div>
              </div>
            )}
            {user?.birthday && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("profile.birthday")}</p>
                  <p className="text-sm font-medium">{user.birthday}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
              <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("adminProfile.twoFactor")}</p>
                <p className="text-sm font-medium">
                  {user?.twoFactorEnabled
                    ? t("adminProfile.enabled")
                    : t("adminProfile.disabled")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Two-factor authentication management (personal preference; only shown
            when the administrator has enabled the 2FA feature). */}
        <div className="md:col-span-3">
          <TwoFactorManagementCard
            disabled={isDemoMode}
            disabledMessage={isDemoMode ? demoMode.message : undefined}
          />
        </div>
      </div>
    </div>
  );
}
