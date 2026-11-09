"""GitHub Trending repos for today. HTML scrape (no API)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import httpx
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; ai-agents-scout/1.0)"
AI_HINT = re.compile(
    r"(AI|LLM|GPT|Claude|Gemini|Llama|RAG|agent|machine[-\s]?learning|"
    r"deep[-\s]?learning|neural|transformer|diffusion|prompt|embedding|"
    r"fine[-\s]?tun|copilot|chatbot|generative|inference|fine-tuning)",
    re.IGNORECASE,
)


def _parse_stars_today(text: str) -> int:
    m = re.search(r"([\d,]+)\s+stars?\s+today", text or "", re.IGNORECASE)
    if not m:
        return 0
    return int(m.group(1).replace(",", ""))


def fetch_github_trending(
    since: str = "daily", max_items: int = 25, ai_only: bool = True
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=20, headers={"User-Agent": UA}, follow_redirects=True) as client:
            r = client.get(f"https://github.com/trending?since={since}")
            r.raise_for_status()
            html = r.text
    except Exception:
        return []

    soup = BeautifulSoup(html, "html.parser")
    articles = soup.select("article.Box-row")
    now = datetime.now(timezone.utc).isoformat()
    for article in articles[: max_items * 2]:
        link = article.select_one("h2 a")
        if not link:
            continue
        href = (link.get("href") or "").strip()
        if not href:
            continue
        repo_name = href.lstrip("/").strip()
        desc_el = article.select_one("p")
        desc = (desc_el.get_text(" ", strip=True) if desc_el else "")[:400]
        lang_el = article.select_one('[itemprop="programmingLanguage"]')
        lang = lang_el.get_text(strip=True) if lang_el else ""
        stars_today_el = article.select_one("span.d-inline-block.float-sm-right")
        stars_today_text = stars_today_el.get_text(" ", strip=True) if stars_today_el else ""
        stars_today = _parse_stars_today(stars_today_text)

        haystack = f"{repo_name} {desc}"
        if ai_only and not AI_HINT.search(haystack):
            continue

        out.append(
            {
                "source": "GitHub Trending",
                "url": f"https://github.com{href}",
                "title": repo_name[:300],
                "summary": (f"[{lang}] " if lang else "") + desc,
                "published_at": now,
                "rank_score": float(stars_today),
            }
        )
        if len(out) >= max_items:
            break
    return out
