import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";
import {
  redirectSignedInVisitor,
  type GuestPageProps,
} from "@/lib/auth/post-login-destination";
import { RegisterPageClient } from "./register-content";

export default async function RegisterPage(props: GuestPageProps) {
  await redirectSignedInVisitor(props);
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
