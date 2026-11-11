const nodemailer = require('nodemailer');

/**
 * Generic outgoing email, configured only through environment variables so no credentials live in code.
 *
 * Option A (recommended, works on hosts that block SMTP such as some Railway plans): Resend over HTTPS
 *   RESEND_API_KEY  API key from resend.com
 *   MAIL_FROM       Sender on a domain verified in Resend, e.g. "Limpia Cleaning <reportes@limpiacleaning.com>"
 *                   (defaults to Resend's test sender, which can only deliver to the Resend account owner)
 *
 * Option B: any SMTP server
 *   MAIL_HOST     SMTP host (e.g. smtp.hostinger.com). If missing, email is considered NOT configured.
 *   MAIL_PORT     SMTP port (default 465 when MAIL_SECURE is true, otherwise 587)
 *   MAIL_SECURE   'true' for implicit TLS (port 465); anything else uses STARTTLS
 *   MAIL_USER     SMTP username (usually the full sender address)
 *   MAIL_PASS     SMTP password
 *   MAIL_FROM     Sender shown to recipients, e.g. "Limpia Cleaning <reportes@limpiacleaning.com>"
 *                 (defaults to MAIL_USER)
 */

let transporter = null;

/**
 * @returns {boolean} True when either Resend or SMTP settings needed to send email are present.
 */
function isMailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY
    || (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS)
  );
}

/**
 * Sends through the Resend HTTP API (no SMTP port needed).
 * @returns {Promise<{messageId:string}>}
 */
async function sendViaResend({ to, subject, text, html, attachments }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Limpia Cleaning <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content).toString('base64'),
      })),
    }),
    signal: AbortSignal.timeout(20000),
  });

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    throw new Error(data?.message || `Resend respondió ${res.status}`);
  }
  return { messageId: data?.id };
}

/**
 * Lazily creates the SMTP transporter (kept for reuse between sends).
 * @returns {import('nodemailer').Transporter}
 */
function getTransporter() {
  if (!transporter) {
    const secure = String(process.env.MAIL_SECURE).toLowerCase() === 'true';
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT) || (secure ? 465 : 587),
      secure,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
      // Fail fast instead of leaving the user waiting on a blocked/unreachable SMTP server
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

/**
 * Sends an email.
 * @param {object} message
 * @param {string|string[]} message.to - Recipient(s).
 * @param {string} message.subject
 * @param {string} message.text - Plain text body (also used by clients that block HTML).
 * @param {string} message.html - HTML body.
 * @param {Array<{filename:string, content:Buffer, contentType?:string}>} [message.attachments]
 * @returns {Promise<{messageId:string}>}
 * @throws {Error} with code 'MAIL_NOT_CONFIGURED' when the SMTP settings are missing.
 */
async function sendMail({ to, subject, text, html, attachments = [] }) {
  if (!isMailConfigured()) {
    const err = new Error('El envío de correo no está configurado en el servidor');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResend({ to, subject, text, html, attachments });
  }
  const info = await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to,
    subject,
    text,
    html,
    attachments,
  });
  return { messageId: info.messageId };
}

module.exports = { isMailConfigured, sendMail };
