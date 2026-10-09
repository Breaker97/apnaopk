"use client";

import { EmailSettingsTab } from "@/components/admin/settings/sections/email-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { useSession } from "@/lib/auth/auth-client";

export default function Page() {
  const {
    savedSettings,
    isSaving,
    isTestingEmail,
    dirtySections,
    updateNestedField,
    updateFieldInSection,
    saveSection,
    discardEdits,
    testSmtp,
  } = useAdminSettingsContext();
  // The test email goes to the signed-in admin unless they type another.
  const { data: session } = useSession();

  return (
    <SectionLoader>
      {(loadedSettings) => {
        const isEmailDirty = dirtySections.has("email");
        const isEmailVerificationDirty = dirtySections.has("emailVerification");

        return (
          <EmailSettingsTab
            settings={loadedSettings}
            savedSettings={savedSettings ?? loadedSettings}
            isSaving={isSaving}
            isEmailDirty={isEmailDirty}
            isVerificationDirty={isEmailVerificationDirty}
            isTestingEmail={isTestingEmail}
            adminEmail={session?.user?.email ?? ""}
            updateNestedField={updateNestedField}
            updateFieldInSection={updateFieldInSection}
            onSave={async () => {
              // Verification first: switching it off is what lets the server
              // details change, and switching it on needs the tested server
              // that is already saved.
              if (isEmailVerificationDirty) {
                const ok = await saveSection("emailVerification", {
                  emailVerificationRequired:
                    loadedSettings.security?.emailVerificationRequired ?? false,
                  emailVerificationForVendors:
                    loadedSettings.security?.emailVerificationForVendors ?? false,
                });
                if (!ok) return;
              }
              if (isEmailDirty) {
                await saveSection("email", loadedSettings.email);
              }
            }}
            onDiscard={discardEdits}
            onTestSmtp={(to) => testSmtp(to)}
            // Only the retention is sent, so other unsaved edits stay in the form.
            onSaveRetention={(days) =>
              saveSection("email", { logRetentionDays: days })
            }
          />
        );
      }}
    </SectionLoader>
  );
}
