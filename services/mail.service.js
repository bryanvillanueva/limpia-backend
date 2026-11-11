const nodemailer = require('nodemailer');

/**
 * Generic outgoing email, configured only through environment variables so no credentials live in code:
 *
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
 * @returns {boolean} True when the SMTP settings needed to send email are present.
 */
function isMailConfigured() {
  return Boolean(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS);
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
