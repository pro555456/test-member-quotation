// utils/mailer.js
const nodemailer = require('nodemailer');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  // 建議使用 SMTP（Mailgun/SendGrid/企業 SMTP 都可）
  const host = requireEnv('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const user = requireEnv('SMTP_USER');
  const pass = requireEnv('SMTP_PASS');

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return _transporter;
}

async function sendMail({ to, subject, html, text }) {
  const from = process.env.SMTP_FROM || requireEnv('SMTP_USER');
  const transporter = getTransporter();

  return transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

module.exports = { sendMail };
