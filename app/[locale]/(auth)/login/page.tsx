import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";
import { demoLoginCredentials } from "@/lib/auth/demo-login";
import {
  redirectSignedInVisitor,
  type GuestPageProps,
} from "@/lib/auth/post-login-destination";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { LoginPageClient } from "./login-content";

export default async function LoginPage(props: GuestPageProps) {
  await redirectSignedInVisitor(props);
  const settings = await getAuthPageSettings();
  // The demo card's Vendor row follows the active theme; a store that is not
  // a demo shows no card, so it skips the read.
  const themeId = isDemoModeEnabled()
    ? (await getStorefrontSettings()).theme.id
    : undefined;

  return (
    <LoginPageClient
      oauthEnabled={{
        google: settings.googleOAuthEnabled,
        facebook: settings.facebookOAuthEnabled,
      }}
      demoCredentials={demoLoginCredentials(themeId)}
    />
  );
}
