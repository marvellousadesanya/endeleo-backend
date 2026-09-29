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

/**
 * The reset link itself.
 *
 * Sent only to an address that actually has an account — but the endpoint that triggers
 * it answers identically either way, so an attacker cannot use it to discover who is
 * registered. The link carries the single-use token; the token is never stored in
 * plaintext anywhere, so this email is the only copy of it in existence.
 *
 * Never throws, for the same reason as the welcome email: the caller has already
 * written the token row, and it must not be rolled back by a mail provider.
 */
export async function sendPasswordResetEmail(
  email: EmailService,
  frontendUrl: string,
  to: string,
  token: string,
  ttlMinutes: number,
): Promise<void> {
  const link = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await email.send(
      to,
      "Reset your Endeleo password",
      emailShell({
        heading: "Reset your password",
        bodyHtml: `
          <p>We received a request to reset the password for this Endeleo account.</p>
          <p>This link works once and expires in ${ttlMinutes} minutes.</p>
          <p style="color:#4a5049;font-size:13px;">If you did not ask for this, you can ignore
             this email — your password has not changed, and the link above will expire on its
             own. Nobody can see your existing password, including us.</p>`,
        ctaLabel: "Choose a new password",
        ctaHref: link,
      }),
    );
  } catch {
    // EmailService logs its own failures.
  }
}

/**
 * Confirmation that a password actually changed.
 *
 * Separate from the reset link on purpose: this one is the alarm. If it arrives and the
 * recipient did nothing, their email account is compromised, not just their password —
 * so it says that rather than congratulating them.
 */
export async function sendPasswordChangedEmail(
  email: EmailService,
  frontendUrl: string,
  to: string,
): Promise<void> {
  try {
    await email.send(
      to,
      "Your Endeleo password was changed",
      emailShell({
        heading: "Your password was changed",
        bodyHtml: `
          <p>The password on your Endeleo account has just been changed, and every signed-in
             session has been signed out.</p>
          <p><strong>If this was not you</strong>, someone has access to this email account —
             reset your password again immediately and secure your email.</p>`,
        ctaLabel: "Sign in",
        ctaHref: `${frontendUrl}/auth`,
      }),
    );
  } catch {
    // EmailService logs its own failures.
  }
}
