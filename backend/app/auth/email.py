import smtplib
import logging
from email.mime.text import MIMEText
from app.config import settings

logger = logging.getLogger("auth_email")


def send_otp_email(to_email: str, otp: str) -> None:
    """
    Sends the OTP by email. If SMTP credentials aren't configured yet (dev mode),
    it prints the code prominently to the backend console so signup can be tested.
    """
    if not settings.SMTP_USER or settings.SMTP_USER == "your-email@gmail.com":
        logger.info("\n" + "=" * 50 + f"\n[DEV MODE] VERIFICATION OTP FOR {to_email}: {otp}\n" + "=" * 50)
        print(f"\n==================================================\n[DEV MODE] VERIFICATION OTP FOR {to_email}: {otp}\n==================================================\n")
        return

    try:
        msg = MIMEText(f"Your FinGraph verification code is: {otp}\nExpires in {settings.OTP_EXPIRE_MINUTES} minutes.")
        msg["Subject"] = "FinGraph — verify your account"
        msg["From"] = settings.SMTP_USER
        msg["To"] = to_email

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=5) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        logger.warning(f"Failed to send email via SMTP: {e}. Outputting OTP to console.")
        print(f"\n==================================================\n[DEV MODE] VERIFICATION OTP FOR {to_email}: {otp}\n==================================================\n")
