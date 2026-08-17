import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings

logger = logging.getLogger("auth_email")


def send_otp_email(to_email: str, otp: str) -> tuple[bool, str | None]:
    """
    Sends a professional HTML verification email containing the 6-digit OTP code.
    Returns a tuple of (success: bool, error_message: str | None).
    """
    sender_email = settings.SMTP_FROM or settings.SMTP_USER or "noreply@fingraph.io"
    subject = "FinGraph — Verify Your Email Address"

    # Plain text version
    text_content = f"""Hello,

Welcome to FinGraph — Real-Time Fraud Syndicate Analytics.

Your email verification code is:

{otp}

This code will expire in {settings.OTP_EXPIRE_MINUTES} minutes.

If you did not request this verification code, you can safely ignore this email.

Regards,
FinGraph Security Team
"""

    # HTML version with modern FinGraph branding
    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #0b0f19;
            color: #e2e8f0;
            margin: 0;
            padding: 0;
        }}
        .container {{
            max-width: 560px;
            margin: 40px auto;
            background: #111827;
            border: 1px solid #1e293b;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
        }}
        .header {{
            background: #0f172a;
            padding: 24px 32px;
            border-bottom: 1px solid #1e293b;
            text-align: center;
        }}
        .badge {{
            display: inline-block;
            background: rgba(45, 217, 196, 0.1);
            color: #2dd9c4;
            font-family: monospace;
            font-size: 11px;
            letter-spacing: 2px;
            text-transform: uppercase;
            padding: 4px 12px;
            border-radius: 9999px;
            border: 1px solid rgba(45, 217, 196, 0.3);
            margin-bottom: 8px;
        }}
        .header h1 {{
            margin: 0;
            font-size: 22px;
            font-weight: 700;
            color: #ffffff;
            letter-spacing: -0.5px;
        }}
        .body-content {{
            padding: 32px;
        }}
        .greeting {{
            font-size: 15px;
            color: #94a3b8;
            margin-bottom: 24px;
        }}
        .code-container {{
            background: #090d16;
            border: 1px dashed #2dd9c4;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            margin: 24px 0;
        }}
        .code {{
            font-family: 'Courier New', Courier, monospace;
            font-size: 36px;
            font-weight: 800;
            letter-spacing: 10px;
            color: #2dd9c4;
            margin: 0;
        }}
        .notice {{
            font-size: 13px;
            color: #64748b;
            line-height: 1.6;
            margin-top: 24px;
        }}
        .footer {{
            background: #090d16;
            padding: 20px 32px;
            border-top: 1px solid #1e293b;
            text-align: center;
            font-size: 12px;
            color: #475569;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="badge">FinGraph Security</div>
            <h1>Verify Your Email Address</h1>
        </div>
        <div class="body-content">
            <p class="greeting">Hello,</p>
            <p style="font-size: 14px; color: #cbd5e1; line-height: 1.5;">
                Welcome to <strong>FinGraph</strong>. Use the 6-digit verification code below to complete your account registration:
            </p>
            <div class="code-container">
                <p class="code">{otp}</p>
            </div>
            <p style="font-size: 13px; color: #94a3b8; text-align: center;">
                ⏱️ This code will expire in <strong>{settings.OTP_EXPIRE_MINUTES} minutes</strong>.
            </p>
            <div class="notice">
                <hr style="border: 0; border-top: 1px solid #1e293b; margin: 20px 0;">
                If you did not request this verification code, please ignore this email or contact support if you suspect unauthorized access.
            </div>
        </div>
        <div class="footer">
            &copy; FinGraph Fraud Syndicate Analytics Desk. All rights reserved.
        </div>
    </div>
</body>
</html>
"""

    if not settings.SMTP_USER or settings.SMTP_USER in ("", "your-email@gmail.com"):
        logger.info(f"[EMAIL SERVICE] Mock mode: SMTP_USER not configured. Verification code generated for target address: {to_email}")
        return True, None

    logger.info(f"[EMAIL SERVICE] Initiating SMTP connection to {settings.SMTP_HOST}:{settings.SMTP_PORT} for {to_email}...")

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = sender_email
        msg["To"] = to_email

        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        logger.info(f"[EMAIL SERVICE] Verification email successfully dispatched to {to_email}")
        return True, None
    except smtplib.SMTPAuthenticationError as auth_err:
        err_msg = f"SMTP authentication failed for user '{settings.SMTP_USER}'. For Gmail accounts, ensure a 16-character Google App Password is set in SMTP_PASSWORD."
        logger.error(f"[EMAIL SERVICE] {err_msg} ({auth_err})")
        return False, err_msg
    except smtplib.SMTPConnectError as conn_err:
        err_msg = f"Could not connect to SMTP server at {settings.SMTP_HOST}:{settings.SMTP_PORT}. Please check network or firewall settings."
        logger.error(f"[EMAIL SERVICE] {err_msg} ({conn_err})")
        return False, err_msg
    except Exception as e:
        err_msg = f"Failed to dispatch email via SMTP ({settings.SMTP_HOST}:{settings.SMTP_PORT}): {str(e)}"
        logger.error(f"[EMAIL SERVICE] {err_msg}")
        return False, err_msg


