import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";
import { demoLoginCredentials } from "@/lib/auth/demo-login";
import { LoginPageClient } from "./login-content";

export default async function LoginPage() {
  const settings = await getAuthPageSettings();

  return (
    <LoginPageClient
      oauthEnabled={{
        google: settings.googleOAuthEnabled,
        facebook: settings.facebookOAuthEnabled,
      }}
      demoCredentials={demoLoginCredentials()}
    />
  );
}
