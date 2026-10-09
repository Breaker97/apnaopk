"use client";

import { SectionLoader } from "@/components/admin/settings/section-loader";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { PaymentSettingsTab } from "@/components/admin/settings/sections/payment-settings-tab";

export default function Page() {
  const {
    isSaving,
    isTestingPayment,
    isRegisteringPesapalIpn,
    dirtySections,
    updateNestedField,
    saveSection,
    testPaymentConnection,
    registerPesapalIpn,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <PaymentSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("payment")}
          isTestingPayment={isTestingPayment}
          isRegisteringPesapalIpn={isRegisteringPesapalIpn}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("payment", loadedSettings.payment)}
          onTestConnection={(provider) => testPaymentConnection(provider)}
          onRegisterPesapalIpn={registerPesapalIpn}
        />
      )}
    </SectionLoader>
  );
}
