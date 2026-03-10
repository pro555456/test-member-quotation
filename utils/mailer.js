// 8. 你的 mailer 建議再做一個正式版小優化
// 正式環境建議 utils/mailer.js 改成同時支援：
// SMTP_SECURE=true/false
// SMTP_ALLOW_SELF_SIGNED=true/false
// 不要只靠 port === 465 判斷。
// 建議正式版寫法
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

  const host = requireEnv('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const user = requireEnv('SMTP_USER');
  const pass = requireEnv('SMTP_PASS');

  const secure = String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')) === 'true';
  const allowSelfSigned = String(process.env.SMTP_ALLOW_SELF_SIGNED || 'false') === 'true';

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: !allowSelfSigned
    }
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