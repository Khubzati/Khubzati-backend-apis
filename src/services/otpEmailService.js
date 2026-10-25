const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'khubzati-logo-email.png');
const LOGO_CID = 'khubzatiLogo';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Brand palette
const CREAM = '#F7F0E5';
const WHITE = '#FFFFFF';
const COCOA = '#542D20';
const CARAMEL = '#C9793B';
const MUTED = '#8A7461';

// Read the logo once at startup and cache its base64 for inline delivery.
let LOGO_BASE64 = null;
try {
  LOGO_BASE64 = fs.readFileSync(LOGO_PATH).toString('base64');
} catch (err) {
  console.warn('OTP email logo not found at', LOGO_PATH, '-', err.message);
}

/**
 * Premium, email-safe (Gmail / Apple Mail / Outlook) RTL verification email.
 * The OTP and expiry are injected from the backend — never hardcoded here.
 * The official Khubzati logo is embedded inline via CID (cid:khubzatiLogo).
 */
function buildOtpEmailHtml(otp, expiryMinutes) {
  const digits = String(otp)
    .split('')
    .map(
      (d) =>
        `<span style="display:inline-block;min-width:34px;font-size:34px;font-weight:700;color:${COCOA};letter-spacing:2px;">${d}</span>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>رمز التحقق</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background-color:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${WHITE};border:1px solid #ECD9C4;border-radius:16px;overflow:hidden;">
<!-- Header -->
<tr>
<td align="center" bgcolor="${COCOA}" style="background-color:${COCOA};padding:22px 24px;">
<img src="cid:${LOGO_CID}" width="150" alt="خبزاتي" style="display:block;width:150px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;">
</td>
</tr>
<!-- Body -->
<tr>
<td dir="rtl" style="padding:34px 36px 10px 36px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;text-align:right;">
<h1 style="margin:0 0 10px 0;font-size:23px;line-height:1.4;color:${COCOA};font-weight:700;">تأكيد بريدك الإلكتروني</h1>
<p style="margin:0;font-size:15px;line-height:1.9;color:${MUTED};">استخدم رمز التحقق التالي لإكمال تسجيلك في خبزاتي.</p>
</td>
</tr>
<!-- OTP -->
<tr>
<td style="padding:22px 36px 6px 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="${CREAM}" style="background-color:${CREAM};border:1px solid #E7D3BC;border-radius:14px;padding:22px 16px;">
<div dir="ltr" style="direction:ltr;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">${digits}</div>
</td>
</tr>
</table>
</td>
</tr>
<!-- Expiry -->
<tr>
<td align="center" style="padding:14px 36px 6px 36px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<p style="margin:0;font-size:14px;line-height:1.7;color:${CARAMEL};font-weight:700;">هذا الرمز صالح لمدة ${expiryMinutes} دقائق</p>
</td>
</tr>
<!-- Security notice -->
<tr>
<td dir="rtl" style="padding:18px 36px 30px 36px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;text-align:right;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="border-top:1px solid #F0E4D4;padding-top:18px;">
<p style="margin:0;font-size:13px;line-height:1.9;color:${MUTED};">لم تطلب هذا الرمز؟ يمكنك تجاهل هذه الرسالة بأمان. حفاظًا على أمان حسابك، لا تُشارك هذا الرمز مع أي شخص.</p>
</td>
</tr>
</table>
</td>
</tr>
<!-- Footer -->
<tr>
<td align="center" bgcolor="${CREAM}" style="background-color:${CREAM};padding:18px 24px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<p style="margin:0;font-size:13px;font-weight:700;color:${COCOA};">خبزاتي</p>
<p style="margin:4px 0 0 0;font-size:12px;color:${MUTED};">طازج من متاجر حارتك</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function buildOtpEmailText(otp, expiryMinutes) {
  return `رمز التحقق الخاص بك في خبزاتي هو: ${otp}
هذا الرمز صالح لمدة ${expiryMinutes} دقائق.
إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة. لا تشارك هذا الرمز مع أي شخص.`;
}

/**
 * Sends the OTP email through the Resend HTTPS API.
 * Render's free plan blocks outbound SMTP ports (25/465/587), so SMTP times out;
 * the HTTPS API avoids that entirely.
 */
async function sendRegistrationOtpEmail(email, otp, expiryMinutes = 10) {
  const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.SMTP_FROM_EMAIL ||
    'onboarding@resend.dev';
  const fromName = process.env.SMTP_FROM_NAME || 'Khubzati';
  if (!apiKey) {
    throw new Error('Signup email delivery is not configured (missing RESEND_API_KEY)');
  }

  const payload = {
    from: `${fromName} <${from}>`,
    to: [email],
    subject: 'رمز التحقق الخاص بك في خبزاتي',
    html: buildOtpEmailHtml(otp, expiryMinutes),
    text: buildOtpEmailText(otp, expiryMinutes),
  };
  if (LOGO_BASE64) {
    payload.attachments = [
      {
        filename: 'khubzati-logo.png',
        content: LOGO_BASE64,
        content_id: LOGO_CID,
      },
    ];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch (_) {
      detail = await response.text().catch(() => '');
    }
    throw new Error(`Resend API error ${response.status}: ${detail}`);
  }
}

module.exports = { sendRegistrationOtpEmail, buildOtpEmailHtml };
