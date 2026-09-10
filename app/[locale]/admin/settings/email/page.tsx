"use client";

import { EmailSettingsTab } from "@/components/admin/settings/sections/email-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const {
    isSaving,
    isTestingEmail,
    testEmail,
    setTestEmail,
    dirtySections,
    updateNestedField,
    updateFieldInSection,
    saveSection,
    testSmtp,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => {
        const isEmailDirty = dirtySections.has("email");
        const isEmailVerificationDirty = dirtySections.has("emailVerification");

        return (
          <EmailSettingsTab
            settings={loadedSettings}
            isSaving={isSaving}
            isDirty={isEmailDirty || isEmailVerificationDirty}
            isTestingEmail={isTestingEmail}
            testEmail={testEmail}
            setTestEmail={setTestEmail}
            updateNestedField={updateNestedField}
            updateFieldInSection={updateFieldInSection}
            onSave={async () => {
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
            onTestSmtp={() => testSmtp()}
          />
        );
      }}
    </SectionLoader>
  );
}
