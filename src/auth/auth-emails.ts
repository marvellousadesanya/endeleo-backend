// Account emails that both signup paths send — password registration and a first
// Google sign-in, which also creates an account. Kept as a plain function rather than
// a service so OAuthService does not have to pull in the whole AuthService for one
// message, and so the wording stays in one place when it changes.
import type { EmailService } from "@/email/email.service";
import { emailShell } from "@/email/email-templates";

/**
 * Confirms to the address itself that an account now exists under it.
 *
 * Until there is a verification flow this is also the only signal an address owner
 * gets that someone signed up using their email, so it says plainly what to do about
 * that rather than only welcoming them.
 *
 * Never throws: the caller is mid-signup, and a mail provider being slow or down must
 * not fail an account creation that already succeeded.
 */
export async function sendWelcomeEmail(
  email: EmailService,
  frontendUrl: string,
  to: string,
  fullName?: string | null,
): Promise<void> {
  const firstName = fullName?.trim() ? fullName.trim().split(/\s+/)[0] : null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  try {
    await email.send(
      to,
      "Your Endeleo account is ready",
      emailShell({
        heading: "Welcome to Endeleo",
        bodyHtml: `
          <p>${greeting}</p>
          <p>Your account has been created with this email address. You can sign in and start
             exploring infrastructure bonds right away.</p>
          <p style="color:#4a5049;font-size:13px;">If you did not create this account, reply to
             this email and we will close it.</p>`,
        ctaLabel: "Sign in",
        ctaHref: `${frontendUrl}/auth`,
      }),
    );
  } catch {
    // EmailService logs its own failures; swallowing here keeps signup atomic.
  }
}
