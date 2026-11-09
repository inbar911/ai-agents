"""Direct Gmail access via IMAP (read-only) + SMTP (send-to-self only).

Replaces Zapier MCP for Gmail. Free, unlimited, no task quota.

SECURITY GUARANTEES (enforced in code, cannot be bypassed by env vars):
- IMAP is opened readonly=True. No deletes, no label changes, no moves.
- send_to_self() refuses any recipient other than REPORT_TO_EMAIL.
- send_to_self() also requires REPORT_TO_EMAIL == GMAIL_USER (self only).
- No reply-to-thread. Always a new outbound message to yourself.
"""
from __future__ import annotations

import email
import email.header
import email.message
import imaplib
import re
import smtplib
import ssl
from pathlib import Path
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from lib.config import require

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
_REPO_ROOT = Path(__file__).resolve().parent.parent


def _decode_header(raw: str) -> str:
    if not raw:
        return ""
    try:
        out: list[str] = []
        for content, enc in email.header.decode_header(raw):
            if isinstance(content, bytes):
                out.append(content.decode(enc or "utf-8", errors="replace"))
            else:
                out.append(content)
        return "".join(out).strip()
    except Exception:
        return raw


def _strip_html(html: str) -> str:
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_body_plain(msg: email.message.Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() != "text/plain":
                continue
            if "attachment" in (part.get("Content-Disposition") or "").lower():
                continue
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                try:
                    return payload.decode(charset, errors="replace")
                except (LookupError, UnicodeDecodeError):
                    return payload.decode("utf-8", errors="replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        return _strip_html(payload.decode(charset, errors="replace"))
                    except (LookupError, UnicodeDecodeError):
                        return _strip_html(payload.decode("utf-8", errors="replace"))
        return ""
    payload = msg.get_payload(decode=True)
    if not payload:
        return ""
    charset = msg.get_content_charset() or "utf-8"
    try:
        text = payload.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        text = payload.decode("utf-8", errors="replace")
    if msg.get_content_type() == "text/html":
        text = _strip_html(text)
    return text


def fetch_recent_emails(
    hours: int = 24, max_messages: int = 50, query_extra: str = ""
) -> list[dict[str, Any]]:
    """Read-only Gmail fetch. Returns list of {id, from, subject, body, received_at}.

    Uses Gmail's X-GM-RAW so we can filter out promotions/social server-side.
    """
    user = require("GMAIL_USER").strip()
    pw = require("GMAIL_APP_PASSWORD").replace(" ", "")
    days = max(1, hours // 24)
    base_query = f"newer_than:{days}d -category:promotions -category:social"
    full_query = f"{base_query} {query_extra}".strip()

    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    ctx = ssl.create_default_context()
    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=ctx)
    try:
        imap.login(user, pw)
        imap.select("INBOX", readonly=True)

        status, data = imap.search(None, "X-GM-RAW", f'"{full_query}"')
        if status != "OK" or not data or not data[0]:
            return []

        ids = data[0].split()
        if len(ids) > max_messages:
            ids = ids[-max_messages:]

        for mid in ids:
            status, msg_data = imap.fetch(mid, "(RFC822)")
            if status != "OK" or not msg_data:
                continue
            raw_bytes: bytes | None = None
            for item in msg_data:
                if isinstance(item, tuple) and len(item) >= 2 and item[1]:
                    raw_bytes = item[1]
                    break
            if not raw_bytes:
                continue

            msg = email.message_from_bytes(raw_bytes)
            mid_header = (
                msg.get("Message-ID")
                or msg.get("Message-Id")
                or f"imap-uid-{mid.decode()}"
            ).strip().strip("<>")

            if mid_header in seen_ids:
                continue
            seen_ids.add(mid_header)

            out.append(
                {
                    "id": mid_header,
                    "from": _decode_header(msg.get("From", ""))[:300],
                    "subject": _decode_header(msg.get("Subject", ""))[:300],
                    "body": _extract_body_plain(msg)[:5000],
                    "received_at": msg.get("Date", ""),
                }
            )
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    return out


def send_to_self(subject: str, body_plain: str, body_html: str | None = None) -> None:
    """Send an email TO YOURSELF ONLY. Hardcoded enforcement.

    Refuses to send if REPORT_TO_EMAIL != GMAIL_USER.
    No way to override via env vars or arguments.
    """
    # Sir's pause switch: while the EMAILS_PAUSED file sits at the repo root,
    # every report is skipped (agents still run and store their data). Delete
    # the file to resume. Returns normally so a run doesn't count as failed.
    if (_REPO_ROOT / "EMAILS_PAUSED").exists():
        print(f"[mailer] paused - skipped: {subject[:120]}")
        return

    user = require("GMAIL_USER").strip().lower()
    pw = require("GMAIL_APP_PASSWORD").replace(" ", "")
    to = require("REPORT_TO_EMAIL").strip().lower()

    if to != user:
        raise PermissionError(
            f"Refusing to send: REPORT_TO_EMAIL ({to}) must equal GMAIL_USER ({user}). "
            "Mailer only delivers to self."
        )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg["Reply-To"] = user
    msg.attach(MIMEText(body_plain, "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))

    ctx = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ctx)
        smtp.ehlo()
        smtp.login(user, pw)
        smtp.sendmail(user, [to], msg.as_string())
