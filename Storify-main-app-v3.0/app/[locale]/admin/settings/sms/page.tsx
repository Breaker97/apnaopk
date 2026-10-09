"use client";

import { SmsSettingsTab } from "@/components/admin/settings/sections/sms-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const {
    savedSettings,
    isSaving,
    isTestingSms,
    testSmsTo,
    setTestSmsTo,
    dirtySections,
    updateNestedField,
    saveSection,
    discardEdits,
    testSms,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <SmsSettingsTab
          settings={loadedSettings}
          savedSettings={savedSettings ?? loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("sms")}
          isTestingSms={isTestingSms}
          testSmsTo={testSmsTo}
          setTestSmsTo={setTestSmsTo}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("sms", loadedSettings.sms)}
          onDiscard={discardEdits}
          onTestSms={testSms}
          // Only the retention is sent, so other unsaved edits stay in the form.
          onSaveRetention={(days) => saveSection("sms", { logRetentionDays: days })}
        />
      )}
    </SectionLoader>
  );
}
