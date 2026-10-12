"""
Brevo (formerly Sendinblue) email provider, sent over HTTPS (port 443).

Why this exists: some hosts (notably Render's free web services) block
outbound SMTP ports 25/465/587, so SMTP providers fail there with
"[Errno 101] Network is unreachable". An HTTPS API works everywhere.

Setup: create a free Brevo account, verify the sender address under
Senders & IP, create an API key (SMTP & API -> API Keys), then set
EMAIL_PROVIDER=brevo, BREVO_API_KEY=<key>, EMAIL_FROM=<verified sender>.
"""
import base64
from email.utils import parseaddr

import httpx

from app.core.config import settings
from app.notifications.base import EmailProvider, EmailMessage

BREVO_URL = "https://api.brevo.com/v3/smtp/email"


class BrevoProvider(EmailProvider):
    name = "brevo"

    def send(self, message: EmailMessage) -> dict:
        if not settings.BREVO_API_KEY or not settings.EMAIL_FROM:
            return {"success": False, "provider_message_id": None,
                    "error": "Brevo not configured (BREVO_API_KEY / EMAIL_FROM unset)."}
        try:
            sender_name, sender_email = parseaddr(settings.EMAIL_FROM)
            sender = {"email": sender_email or settings.EMAIL_FROM}
            if sender_name:
                sender["name"] = sender_name

            payload = {
                "sender": sender,
                "to": [{"email": message.to}],
                "subject": message.subject,
                "textContent": message.body,
            }
            if message.cc:
                payload["cc"] = [{"email": c} for c in message.cc]
            if message.attachments:
                payload["attachment"] = [
                    {"name": a.filename, "content": base64.b64encode(a.content).decode()}
                    for a in message.attachments
                ]

            resp = httpx.post(
                BREVO_URL,
                headers={"api-key": settings.BREVO_API_KEY, "accept": "application/json"},
                json=payload,
                timeout=20.0,
            )
            if resp.status_code >= 400:
                try:
                    detail = resp.json().get("message", resp.text)
                except Exception:
                    detail = resp.text
                return {"success": False, "provider_message_id": None,
                        "error": f"Brevo {resp.status_code}: {detail}"}
            return {"success": True, "provider_message_id": resp.json().get("messageId"), "error": None}
        except Exception as e:
            return {"success": False, "provider_message_id": None, "error": str(e)}
