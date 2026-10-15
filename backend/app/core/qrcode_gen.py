"""
QR code per machine (Future-Ready item C.1): a technician scans the code
bolted to the machine and lands straight on that machine's mobile page
(PM history + a "mark complete" action), no searching/typing a machine
number on a phone keyboard.

The QR payload is just a URL into the (responsive-web) frontend -
`{APP_URL}/m/{machine_id}` - so this needs zero new auth machinery: the
frontend route handles login the same way any other page does. Anyone
implementing item C.2 (technician mobile view) should treat `/m/{id}` as
the route this code expects to exist.
"""

import io
from urllib.parse import urlparse

import qrcode

from app.core.config import settings


def resolve_base_url(base: str | None = None) -> str:
    """
    Where the QR should point. APP_URL on Render often still says
    http://localhost:3000, which makes every printed label useless, so the
    frontend passes the address it is actually running on (`base`). It is only
    trusted if it matches APP_URL or one of CORS_ORIGINS (so nobody can make
    the server mint a QR that points at some other site).
    """
    app_url = (settings.APP_URL or "").rstrip("/")
    if base:
        b = base.strip().rstrip("/")
        u = urlparse(b)
        if u.scheme in ("http", "https") and u.netloc and not u.path.strip("/"):
            allowed = {o.strip().rstrip("/") for o in settings.CORS_ORIGINS.split(",") if o.strip()}
            allowed.add(app_url)
            if b in allowed or "*" in allowed:
                return b
    return app_url


def machine_deep_link(machine_id: str, base: str | None = None) -> str:
    return f"{resolve_base_url(base)}/m/{machine_id}"


def generate_machine_qr_png(machine_id: str, base: str | None = None) -> bytes:
    """Returns PNG bytes for a QR code encoding this machine's deep link."""
    img = qrcode.make(machine_deep_link(machine_id, base), box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
