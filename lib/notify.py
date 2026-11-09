"""Deliver an agent report to Inbar on both channels: email (self only) + Telegram.

Each agent speaks through its own Telegram bot (token `bot_tg_<agent>` in Supabase
Vault, falling back to the JARVIS bot). When Inbar's group is set up (`/setup` in
the group), the message goes to that agent's topic there; otherwise to his DM.
Tokens and chat ids are read with the service key, so no extra GitHub secret exists
and a bot can only ever message Inbar's own chat or group.
"""
from __future__ import annotations

import json
import os
import re
import sys

import httpx

from lib.mailer import send_to_self
from lib.supabase_client import sb

_TELEGRAM_LIMIT = 3900  # Telegram caps a message at 4096 chars


def _secret(name: str) -> str | None:
    return sb().rpc("get_bot_secret", {"secret_name": name}).execute().data or None


def _setting(key: str) -> str | None:
    rows = sb().table("bot_settings").select("value").eq("key", key).limit(1).execute().data or []
    return rows[0]["value"] if rows else None


def _plain(md: str) -> str:
    """Telegram gets plain text: drop markdown markers that would show up literally."""
    text = re.sub(r"^#{1,6} +", "", md, flags=re.M)   # headings only: a #hashtag at line start must survive
    text = text.replace("**", "").replace("__", "")
    return re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1 — \2", text)


def _chunks(text: str, sections: bool = True) -> list[str]:
    out: list[str] = []
    for part in (re.split(r"\n-{3,}\n", text) if sections else [text]):
        for i in range(0, len(part), _TELEGRAM_LIMIT):
            piece = part[i : i + _TELEGRAM_LIMIT].strip()
            if piece:
                out.append(piece)
    return out


def _destination(bot: str) -> dict[str, object]:
    group_id = _setting("group_id")
    topics = json.loads(_setting("group_topics") or "{}")
    if group_id and bot in topics:
        return {"chat_id": group_id, "message_thread_id": topics[bot]}
    chat_id = _secret("allowed_chat_id")
    if not chat_id:
        raise RuntimeError("missing bot secret: allowed_chat_id")
    return {"chat_id": chat_id}


def _check(res: httpx.Response) -> None:
    """Raise with Telegram's own reason; httpx's error would print the URL, which holds the bot token."""
    if not res.is_success:
        try:
            reason = res.json().get("description", "")
        except ValueError:
            reason = ""
        raise RuntimeError(f"{res.status_code} {reason}".strip())


def send_telegram(md: str, bot: str = "jarvis", sections: bool = True) -> None:
    """sections=True sends each ---separated part as its own message; False keeps it one message (split only past the limit)."""
    token = _secret(f"tg_{bot}") or _secret("telegram_token")
    if not token:
        raise RuntimeError("missing bot secret: telegram_token")
    dest = _destination(bot)
    with httpx.Client(timeout=20) as client:
        for chunk in _chunks(_plain(md), sections):
            res = client.post(f"https://api.telegram.org/bot{token}/sendMessage", json={**dest, "text": chunk})
            _check(res)


def _send_file(method: str, field: str, path: "os.PathLike[str]", name: str, mime: str, caption: str, bot: str,
               extra: dict[str, str] | None = None) -> None:
    token = _secret(f"tg_{bot}") or _secret("telegram_token")
    if not token:
        raise RuntimeError("missing bot secret: telegram_token")
    dest = {k: str(v) for k, v in _destination(bot).items()}
    with open(path, "rb") as f, httpx.Client(timeout=300) as client:
        res = client.post(f"https://api.telegram.org/bot{token}/{method}",
                          data={**dest, "caption": caption[:1000], **(extra or {})}, files={field: (name, f, mime)})
        _check(res)


def send_video(path: "os.PathLike[str]", caption: str, bot: str = "jarvis") -> None:
    """The file itself (bots may upload up to 50MB), so Inbar can save it straight from Telegram."""
    _send_file("sendVideo", "video", path, "video.mp4", "video/mp4", caption, bot, {"supports_streaming": "true"})


def send_image_file(path: "os.PathLike[str]", caption: str, bot: str = "jarvis") -> None:
    """An image sent as a file, not a photo: Telegram would recompress a photo; this keeps full quality."""
    _send_file("sendDocument", "document", path, "cover.jpg", "image/jpeg", caption, bot)


def request() -> str:
    """What Inbar asked for when JARVIS dispatched this run ('' on scheduled runs)."""
    return os.getenv("AGENT_REQUEST", "").strip()[:500]


def notify(subject: str, body_md: str, body_html: str | None = None, bot: str = "jarvis", sections: bool = True) -> None:
    """Both channels; one failing doesn't stop the other, but any failure is raised at the end."""
    errors: list[str] = []
    try:
        send_to_self(subject, body_md, body_html)
    except Exception as e:  # noqa: BLE001 — report every channel, then fail loudly
        errors.append(f"email: {e}")
    try:
        send_telegram(f"{subject}\n\n{body_md}", bot, sections)
    except Exception as e:  # noqa: BLE001
        errors.append(f"telegram: {e}")
    if errors:
        print(f"[notify] {'; '.join(errors)}", file=sys.stderr)
        raise RuntimeError("; ".join(errors))
