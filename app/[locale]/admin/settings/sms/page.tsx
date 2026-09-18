"use client";

import { SmsSettingsTab } from "@/components/admin/settings/sections/sms-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const {
    isSaving,
    isTestingSms,
    testSmsTo,
    setTestSmsTo,
    dirtySections,
    updateNestedField,
    saveSection,
    testSms,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <SmsSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("sms")}
          isTestingSms={isTestingSms}
          testSmsTo={testSmsTo}
          setTestSmsTo={setTestSmsTo}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("sms", loadedSettings.sms)}
          onTestSms={() => testSms()}
        />
      )}
    </SectionLoader>
  );
}
