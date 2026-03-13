const nodemailer = require('nodemailer');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

let transporterCache = null;

function getTransporter() {
  if (transporterCache) return transporterCache;

  const host = requireEnv('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const user = requireEnv('SMTP_USER');
  const pass = requireEnv('SMTP_PASS');
  const secure = String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')) === 'true';
  const allowSelfSigned = String(process.env.SMTP_ALLOW_SELF_SIGNED || 'false') === 'true';

  transporterCache = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: !allowSelfSigned },
  });

  return transporterCache;
}

async function sendMail({ to, cc, bcc, subject, html, text, attachments = [] }) {
  const from = process.env.SMTP_FROM || requireEnv('SMTP_USER');
  const transporter = getTransporter();

  return transporter.sendMail({
    from,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    attachments,
  });
}

module.exports = { sendMail };
