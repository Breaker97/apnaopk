import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";
import { RegisterPageClient } from "./register-content";

export default async function RegisterPage() {
  const settings = await getAuthPageSettings();

  return (
    <RegisterPageClient
      oauthEnabled={{
        google: settings.googleOAuthEnabled,
        facebook: settings.facebookOAuthEnabled,
      }}
      emailVerificationRequired={settings.emailVerificationRequired}
    />
  );
}
