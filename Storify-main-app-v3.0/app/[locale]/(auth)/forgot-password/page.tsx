import {
  redirectSignedInVisitor,
  type GuestPageProps,
} from "@/lib/auth/post-login-destination";
import { ForgotPasswordPageClient } from "./forgot-password-content";

export default async function ForgotPasswordPage(props: GuestPageProps) {
  await redirectSignedInVisitor(props);

  return <ForgotPasswordPageClient />;
}
