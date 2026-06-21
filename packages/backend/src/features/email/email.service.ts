import mjml2html from "mjml";
import nodemailer from "nodemailer";
import { env } from "../../config/env.config.js";

export interface EmailPort {
  sendVerifyOtp(to: string, code: string): Promise<void>;
  sendResetOtp(to: string, code: string): Promise<void>;
  sendAccountLocked(to: string): Promise<void>;
  sendCardDueSoon(to: string, cardTitle: string, link: string): Promise<void>;
  sendCommentMention(
    to: string,
    cardTitle: string,
    snippet: string,
    link: string,
  ): Promise<void>;
  sendCardAssigned(to: string, cardTitle: string, link: string): Promise<void>;
}

function render(template: string): string {
  const out = mjml2html(template) as unknown as {
    html: string;
    errors?: { formattedMessage: string }[];
  };
  if (out.errors?.length) {
    console.warn("MJML render warnings:", out.errors.map((e) => e.formattedMessage));
  }
  return out.html;
}

// Escape interpolated values to prevent HTML/markup injection if any
// user-controlled string is ever passed into a template.
export function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function otpTemplate(title: string, intro: string, code: string): string {
  return render(`
    <mjml>
      <mj-body>
        <mj-section>
          <mj-column>
            <mj-text font-size="20px" font-weight="bold">${esc(title)}</mj-text>
            <mj-text>${esc(intro)}</mj-text>
            <mj-text font-size="28px" font-weight="bold" letter-spacing="4px">${esc(code)}</mj-text>
            <mj-text color="#888">This code expires in 10 minutes.</mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>
  `);
}

function noticeTemplate(title: string, body: string, link: string): string {
  return render(`
    <mjml>
      <mj-body>
        <mj-section>
          <mj-column>
            <mj-text font-size="20px" font-weight="bold">${esc(title)}</mj-text>
            <mj-text>${esc(body)}</mj-text>
            <mj-button href="${esc(link)}">Open card</mj-button>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>
  `);
}

function lockedTemplate(): string {
  return render(`
    <mjml>
      <mj-body>
        <mj-section>
          <mj-column>
            <mj-text font-size="20px" font-weight="bold">Account temporarily locked</mj-text>
            <mj-text>Too many failed login attempts. Your account is locked for a short period.</mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>
  `);
}

export function createEmailService(): EmailPort {
  const transport = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    auth: env.MAIL_USER ? { user: env.MAIL_USER, pass: env.MAIL_PASS } : undefined,
  });

  const send = (to: string, subject: string, html: string) =>
    transport.sendMail({ from: env.MAIL_FROM, to, subject, html }).then(() => undefined);

  return {
    sendVerifyOtp: (to, code) =>
      send(to, "Verify your email", otpTemplate("Verify your email", "Use this code to verify your account:", code)),
    sendResetOtp: (to, code) =>
      send(to, "Reset your password", otpTemplate("Reset your password", "Use this code to reset your password:", code)),
    sendAccountLocked: (to) => send(to, "Account locked", lockedTemplate()),
    sendCardDueSoon: (to, cardTitle, link) =>
      send(
        to,
        `Card due soon: ${cardTitle}`,
        noticeTemplate(
          "A card is due soon",
          `"${cardTitle}" is due soon.`,
          link,
        ),
      ),
    sendCommentMention: (to, cardTitle, snippet, link) =>
      send(
        to,
        `You were mentioned on: ${cardTitle}`,
        noticeTemplate(
          "You were mentioned",
          `On "${cardTitle}": ${snippet}`,
          link,
        ),
      ),
    sendCardAssigned: (to, cardTitle, link) =>
      send(
        to,
        `You were assigned: ${cardTitle}`,
        noticeTemplate(
          "You were assigned to a card",
          `You were assigned to "${cardTitle}".`,
          link,
        ),
      ),
  };
}

export const emailService: EmailPort = createEmailService();
