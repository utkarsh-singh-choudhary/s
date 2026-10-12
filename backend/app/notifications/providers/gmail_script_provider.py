"""
Gmail sender via a small Google Apps Script web app (HTTPS, port 443).

Why this exists: hosts like Render's free tier block SMTP ports, and the
Gmail API provider needs a Google Cloud OAuth client. This option needs
neither: the admin pastes a ~20-line script into script.google.com, deploys
it as a web app under their own Gmail account, and this provider POSTs each
email to it. Mail is sent from that Gmail account.

Env vars: EMAIL_PROVIDER=gmail_script, GMAIL_SCRIPT_URL=<web app URL>,
GMAIL_SCRIPT_SECRET=<same secret as in the script>.
Consumer Gmail allows roughly 100 recipients per day through Apps Script.
"""
import base64
from email.utils import parseaddr

import httpx

from app.core.config import settings
from app.notifications.base import EmailProvider, EmailMessage


class GmailScriptProvider(EmailProvider):
    name = "gmail_script"

    def send(self, message: EmailMessage) -> dict:
        if not settings.GMAIL_SCRIPT_URL or not settings.GMAIL_SCRIPT_SECRET:
            return {"success": False, "provider_message_id": None,
                    "error": "Gmail script not configured (GMAIL_SCRIPT_URL / GMAIL_SCRIPT_SECRET unset)."}
        try:
            payload = {
                "secret": settings.GMAIL_SCRIPT_SECRET,
                "to": message.to,
                "subject": message.subject,
                "body": message.body,
            }
            sender_name, _ = parseaddr(settings.EMAIL_FROM or "")
            if sender_name:
                payload["name"] = sender_name
            if message.cc:
                payload["cc"] = ",".join(message.cc)
            if message.attachments:
                payload["attachments"] = [
                    {"name": a.filename, "content": base64.b64encode(a.content).decode()}
                    for a in message.attachments
                ]

            resp = httpx.post(settings.GMAIL_SCRIPT_URL, json=payload, timeout=60.0, follow_redirects=True)
            try:
                data = resp.json()
            except Exception:
                return {"success": False, "provider_message_id": None,
                        "error": "Script did not return JSON. Check the web app is deployed with "
                                 "'Who has access: Anyone' and the URL ends in /exec."}
            if data.get("ok"):
                return {"success": True, "provider_message_id": None, "error": None}
            return {"success": False, "provider_message_id": None, "error": f"Script error: {data.get('error')}"}
        except Exception as e:
            return {"success": False, "provider_message_id": None, "error": str(e)}
