"""Complaint discovery via DuckDuckGo HTML search.

DuckDuckGo allows scraping its HTML SERP without API keys or auth.
We craft targeted queries that surface user complaints across the web
(Reddit, IndieHackers, HN, dev.to, forums, etc.) and use the SERP
snippets as the complaint signal.

Free, no quotas, no login. Rate-limited politely.
"""
from __future__ import annotations

import hashlib
import re
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

DDG_HTML = "https://html.duckduckgo.com/html/"

DEFAULT_QUERIES: list[str] = [
    'site:reddit.com "I wish there was a tool" SaaS',
    'site:reddit.com "is there a tool for" small business',
    'site:reddit.com "looking for a tool" sysadmin OR devops',
    'site:reddit.com "frustrated with" freelance',
    'site:reddit.com "wish there was an app" productivity',
    'site:reddit.com "why is there no" workflow',
    'site:indiehackers.com pain workflow',
    'site:news.ycombinator.com "Ask HN" "tool for"',
    'site:dev.to "I hate when" workflow',
    '"I wish there was a tool that" -site:youtube.com',
]


def _clean_ddg_link(href: str) -> str:
    if not href:
        return ""
    if href.startswith("//duckduckgo.com/l/?"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        qs = parse_qs(parsed.query)
        target = qs.get("uddg") or qs.get("u")
        if target:
            return target[0]
    return href


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return "web"


def ddg_search(query: str, max_results: int = 15) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        with httpx.Client(
            timeout=25,
            headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"},
            follow_redirects=True,
        ) as client:
            r = client.post(DDG_HTML, data={"q": query})
            r.raise_for_status()
            html = r.text
    except Exception:
        return []

    soup = BeautifulSoup(html, "html.parser")
    results = soup.select(".result")
    for result in results[: max_results * 2]:
        link_el = result.select_one(".result__a")
        snippet_el = result.select_one(".result__snippet")
        if not link_el:
            continue
        href = _clean_ddg_link(str(link_el.get("href") or "").strip())
        if not href or not href.startswith("http"):
            continue
        title = link_el.get_text(" ", strip=True)
        snippet = snippet_el.get_text(" ", strip=True) if snippet_el else ""
        if not title:
            continue
        out.append(
            {
                "url": href,
                "title": title[:300],
                "snippet": snippet[:500],
            }
        )
        if len(out) >= max_results:
            break
    return out


def complaint_hash(url: str, title: str) -> str:
    return hashlib.sha1(f"{url}|{title}".encode("utf-8")).hexdigest()[:32]


def fetch_complaints_via_search(
    queries: list[str] | None = None,
    per_query: int = 10,
    polite_sleep_seconds: float = 2.5,
) -> list[dict[str, Any]]:
    targets = queries or DEFAULT_QUERIES
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for q in targets:
        results = ddg_search(q, max_results=per_query)
        for r in results:
            if r["url"] in seen:
                continue
            seen.add(r["url"])
            out.append(
                {
                    "subreddit": _domain(r["url"]),
                    "title": r["title"],
                    "selftext": r["snippet"],
                    "url": r["url"],
                    "score": 0,
                    "num_comments": 0,
                    "created_utc": 0,
                    "query": q,
                    "hash": complaint_hash(r["url"], r["title"]),
                }
            )
        time.sleep(polite_sleep_seconds)
    return out
