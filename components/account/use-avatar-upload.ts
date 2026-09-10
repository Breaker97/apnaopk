"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth/auth-client";
import { toast } from "@/components/ui/toast-notification";
import {
  DEFAULT_PROFILE_DEMO_MODE,
  normalizeDemoModeState,
} from "@/lib/demo-mode-shared";

/**
 * Avatar picker shared by the desktop sidebar and the mobile identity strip.
 *
 * The profile form has no avatar field, so this is the only way a shopper can
 * change their photo — which is why the mobile strip keeps the affordance even
 * though the bordered identity card it replaced is gone.
 *
 * Demo mode is only enforced on the profile page, matching the original
 * sidebar behaviour: that is where the server refuses profile writes.
 */
export function useAvatarUpload(locale: string) {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [demoMode, setDemoMode] = useState(DEFAULT_PROFILE_DEMO_MODE);

  const isProfilePage = pathname === `/${locale}/account/profile`;
  const isProfileDemoMode = isProfilePage && demoMode.enabled;

  useEffect(() => {
    if (!isProfilePage) return;

    let isActive = true;

    const loadDemoMode = async () => {
      try {
        const res = await fetch("/api/user/profile");
        const json = await res.json().catch(() => null);
        const loadedDemoMode = json?.data?.demoMode;
        if (!isActive) return;
        setDemoMode(normalizeDemoModeState(loadedDemoMode));
      } catch {}
    };

    void loadDemoMode();

    return () => {
      isActive = false;
    };
  }, [isProfilePage]);

  const openPicker = () => {
    if (isProfileDemoMode) {
      toast.error(demoMode.message);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isProfileDemoMode) {
      toast.error(demoMode.message);
      e.target.value = "";
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
    if (!file.type.startsWith("image/")) {
      toast.error(`"${file.name}" is not an image file. Please select an image.`);
      e.target.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "avatar");

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        // Surface the server's exact reason (size limit, disallowed type,
        // storage misconfiguration, …) instead of failing silently.
        const serverError =
          Array.isArray(json?.errors) && json.errors.length > 0
            ? json.errors.join(", ")
            : json?.message;
        throw new Error(
          serverError || `Upload failed for ${file.name} (${fileSizeMB}MB)`,
        );
      }

      const uploadedUrl =
        (Array.isArray(json?.data) ? json.data?.[0]?.url : json?.url) ??
        undefined;
      if (!uploadedUrl) {
        throw new Error("Upload succeeded but URL is missing");
      }

      await authClient.updateUser({ image: uploadedUrl }).catch(() => null);

      const profileRes = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: uploadedUrl }),
      });
      const profileJson = await profileRes.json().catch(() => null);
      if (!profileRes.ok || profileJson?.success === false) {
        throw new Error(
          profileJson?.message || "Failed to save the new avatar to your profile",
        );
      }

      window.location.reload();
    } catch (error) {
      console.error("Failed to upload avatar:", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to upload avatar",
      );
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  // The ref is returned as a separate tuple slot rather than a field on the
  // object: bundled together, the react-hooks/refs rule reads every access on
  // that object as a ref read during render.
  return [
    { isUploading, isDisabled: isUploading || isProfileDemoMode, openPicker, handleFileChange },
    fileInputRef,
  ] as const;
}
