const nodemailer = require('nodemailer');

// Configure Transporter based on Environment Variables or Fallback Mailer
function createTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = parseInt(process.env.SMTP_PORT || '587');

    if (host && user && pass) {
        if (host.includes('gmail')) {
            return nodemailer.createTransport({
                service: 'gmail',
                auth: { user, pass }
            });
        }
        return nodemailer.createTransport({
            host: host,
            port: port,
            secure: port === 465,
            auth: { user, pass }
        });
    }

    // Direct / Test fallback transport for development and real email dispatch attempts
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER || 'nexdesign.auth@gmail.com',
            pass: process.env.GMAIL_APP_PASSWORD || ''
        }
    });
}

/**
 * Send High-Prestige OTP Verification Email to User's Real Email Address
 * @param {string} toEmail - Recipient email address
 * @param {string} otpCode - 6-digit OTP code
 */
async function sendOTPEmail(toEmail, otpCode) {
    const fromAddress = process.env.SMTP_FROM || '"NEX Architecture" <no-reply@nex3dcore.com>';
    const subject = `NEX-${otpCode}: NexDesign Güvenlik Doğrulama Kodunuz`;

    const htmlBody = `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #08080a; color: #e4e4e7; margin: 0; padding: 40px 20px; }
            .email-container { max-width: 520px; margin: 0 auto; background: #121216; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 36px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            .logo { font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: 2px; margin-bottom: 24px; text-align: center; }
            .logo span { color: #34d399; }
            .title { font-size: 20px; font-weight: 600; color: #ffffff; margin-bottom: 12px; text-align: center; }
            .subtitle { font-size: 13px; color: #a1a1aa; line-height: 1.5; text-align: center; margin-bottom: 28px; }
            .otp-box { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 28px; }
            .otp-code { font-family: 'Courier New', monospace; font-size: 36px; font-weight: 700; color: #34d399; letter-spacing: 10px; margin: 0; }
            .notice { font-size: 11px; color: #71717a; text-align: center; line-height: 1.5; }
            .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 10px; color: #52525b; text-align: center; }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="logo">NEX<span>.</span></div>
            <div class="title">E-Posta Adresinizi Doğrulayın</div>
            <div class="subtitle">NexDesign mimari tasarım lisansınızı aktifleştirmek için aşağıdaki 6 haneli güvenlik kodunu kullanın:</div>
            
            <div class="otp-box">
                <div class="otp-code">${otpCode}</div>
            </div>

            <div class="notice">
                ⏰ Bu kod <strong>10 dakika</strong> boyunca geçerlidir.<br>
                🔒 Güvenliğiniz için bu kodu kimseyle paylaşmayın. Eğer bu kaydı siz başlatmadıysanız bu e-postayı dikkate almayın.
            </div>

            <div class="footer">
                &copy; 2026 NEX Architecture & Software Core. Tüm hakları saklıdır.
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        const transporter = createTransporter();
        const info = await transporter.sendMail({
            from: fromAddress,
            to: toEmail,
            subject: subject,
            text: `NexDesign Güvenlik Doğrulama Kodunuz: ${otpCode} (10 dakika geçerlidir)`,
            html: htmlBody
        });

        console.log(`✉️ REAL EMAIL SENT to [${toEmail}] - MessageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.warn(`⚠️ Real Email dispatch notice for [${toEmail}]: ${err.message}`);
        return { success: false, error: err.message };
    }
}

module.exports = { sendOTPEmail };
