"""Free finance snapshots via Yahoo Finance public chart endpoint.

No API key. Yahoo throttles aggressive callers but a few queries per week
with a real UA is fine.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

TICKERS: list[tuple[str, str]] = [
    ("AAPL", "Apple Inc"),
    ("NXSN.TA", "Next Vision Systems (TASE)"),
    ("^GSPC", "S&P 500"),
]


def fetch_quote(symbol: str) -> dict[str, Any] | None:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    try:
        with httpx.Client(
            timeout=20, headers={"User-Agent": UA}, follow_redirects=True
        ) as client:
            r = client.get(url, params={"range": "10d", "interval": "1d"})
            r.raise_for_status()
            data = r.json()
    except Exception:
        return None

    results = data.get("chart", {}).get("result")
    if not results:
        return None
    result = results[0]
    meta = result.get("meta", {}) or {}
    indicators = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes_raw = indicators.get("close") or []
    closes = [c for c in closes_raw if isinstance(c, (int, float))]
    if not closes:
        return None

    latest = float(closes[-1])
    prev = float(closes[-2]) if len(closes) > 1 else latest
    change = latest - prev
    pct = (change / prev * 100.0) if prev else 0.0

    week_ago = float(closes[0])
    week_change = latest - week_ago
    week_pct = (week_change / week_ago * 100.0) if week_ago else 0.0

    market_ts = meta.get("regularMarketTime") or 0
    as_of = ""
    if market_ts:
        try:
            as_of = datetime.fromtimestamp(market_ts, tz=timezone.utc).isoformat()
        except Exception:
            as_of = ""

    return {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": meta.get("currency") or "",
        "latest": latest,
        "prev_close": prev,
        "change": change,
        "change_pct": pct,
        "week_change": week_change,
        "week_change_pct": week_pct,
        "as_of": as_of,
    }


def fetch_all_quotes(
    tickers: list[tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    targets = tickers or TICKERS
    out: list[dict[str, Any]] = []
    for sym, name in targets:
        q = fetch_quote(sym)
        if q:
            q["display_name"] = name
            out.append(q)
    return out
