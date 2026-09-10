import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";
import { LoginPageClient } from "./login-content";

export default async function LoginPage() {
  const settings = await getAuthPageSettings();

  return (
    <LoginPageClient
      oauthEnabled={{
        google: settings.googleOAuthEnabled,
        facebook: settings.facebookOAuthEnabled,
      }}
      demoModeEnabled={settings.demoMode}
    />
  );
}
