"""Shared upload rules for photos / PDFs stored in the database."""

import os

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".pdf", ".heic", ".webp"}
MAX_FILE_BYTES = 15 * 1024 * 1024  # 15 MB per file
MAX_FILES_PER_ENTITY = 30


def sniff_content_type(data: bytes) -> str | None:
    """Real file type from the first bytes - never trust the filename or what the browser says."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:5] == b"%PDF-":
        return "application/pdf"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heim", b"heis"):
        return "image/heic"
    return None


def safe_filename(name: str) -> str:
    base = os.path.basename(name or "file").replace("\r", "").replace("\n", "").replace('"', "")
    return base[:255] or "file"
