import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";
import { demoLoginCredentials } from "@/lib/auth/demo-login";
import {
  redirectSignedInVisitor,
  type GuestPageProps,
} from "@/lib/auth/post-login-destination";
import { LoginPageClient } from "./login-content";

export default async function LoginPage(props: GuestPageProps) {
  await redirectSignedInVisitor(props);
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
