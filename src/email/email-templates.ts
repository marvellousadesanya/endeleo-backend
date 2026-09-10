// One plain, on-brand wrapper around every email's actual content, so a new alert is
// just a subject line and a couple of paragraphs, not a new HTML document.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8080";

export function emailShell(opts: { heading: string; bodyHtml: string; ctaLabel?: string; ctaHref?: string }) {
  const cta =
    opts.ctaLabel && opts.ctaHref
      ? `<tr><td style="padding-top:24px;">
           <a href="${opts.ctaHref}" style="display:inline-block;background:#0f6b4f;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px;">${opts.ctaLabel}</a>
         </td></tr>`
      : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:32px;">
          <tr><td style="font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#0f6b4f;">Endeleo</td></tr>
          <tr><td style="padding-top:14px;font-size:19px;font-weight:700;color:#101312;">${opts.heading}</td></tr>
          <tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#4a5049;">${opts.bodyHtml}</td></tr>
          ${cta}
          <tr><td style="padding-top:32px;font-size:12px;color:#9aa39a;border-top:1px solid #eef0ed;margin-top:24px;padding-top:16px;">
            You're receiving this because it relates to your Endeleo account. Manage alerts under
            <a href="${FRONTEND_URL}/dashboard/settings" style="color:#0f6b4f;">Settings</a>.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
