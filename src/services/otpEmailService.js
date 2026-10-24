const nodemailer = require('nodemailer');

async function sendRegistrationOtpEmail(email, otp) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL } = process.env;
  const from = SMTP_FROM_EMAIL || SMTP_USER;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !from) {
    throw new Error('Signup email delivery is not configured');
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  const result = await transport.sendMail({
    from: { name: process.env.SMTP_FROM_NAME || 'Khubzati', address: from },
    to: email,
    subject: 'Your Khubzati verification code',
    text: `Your Khubzati signup verification code is ${otp}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
  });
  if (!result.accepted?.length) {
    throw new Error('Email provider rejected the signup recipient');
  }
}

module.exports = { sendRegistrationOtpEmail };
