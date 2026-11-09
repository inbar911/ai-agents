"""Groq free-tier wrapper for classification + summarization.

Batches inputs to stay under Groq free-tier TPM cap (12,000 tokens/min).
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

from groq import BadRequestError, Groq, RateLimitError

from lib.config import require

_client: Groq | None = None
# llama-3.3-70b-versatile was decommissioned by Groq — every agent run 404'd
# on it. GROQ_MODEL lets the next retirement be fixed by a repo variable
# instead of a code change.
MODEL = os.getenv("GROQ_MODEL") or "openai/gpt-oss-120b"

BODY_TRUNCATE_CHARS = 700
EMAILS_PER_BATCH = 8
BATCH_SLEEP_SECONDS = 4


def groq() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=require("GROQ_API_KEY"))
    return _client


GATEKEEPER_SYSTEM = """You are an email triage agent for a Micro-SaaS builder.

Classify each input email into exactly one tag:
- "opportunity": the email contains a workflow complaint, tech frustration, missing-tool gripe,
  or "I wish there was a tool that..." pattern. This is the seed for Micro-SaaS ideas.
- "important": direct human correspondence requiring attention (client, billing, deadline,
  personal, account security, legal). NOT marketing, NOT automated digests.
- "noise": newsletters, automated notifications, marketing, social, transactional receipts
  with nothing actionable, calendar invites already in calendar.

For every email, also produce a 1-line summary.
- If the email body is mostly Hebrew, write the summary in Hebrew.
- Otherwise English.
- Max 140 chars. No filler.

For "opportunity" emails ONLY, also extract:
- complaint: the specific pain point in 1 sentence.
- domain: 1-3 word domain label (e.g. "email automation", "calendar sync", "invoice parsing").

Output STRICT JSON: {"results": [{"id": "<id>", "tag": "...", "summary": "...", "complaint": "..." | null, "domain": "..." | null}, ...]}
No prose, no markdown, no commentary."""


def _classify_batch(batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload = [
        {
            "id": e["id"],
            "from": (e.get("from") or "")[:120],
            "subject": (e.get("subject") or "")[:200],
            "body": (e.get("body") or "")[:BODY_TRUNCATE_CHARS],
        }
        for e in batch
    ]
    parsed = ask_json(GATEKEEPER_SYSTEM, payload, max_tokens=2000, temperature=0.2)
    results = parsed.get("results")
    if not isinstance(results, list):
        for v in parsed.values():
            if isinstance(v, list):
                results = v
                break
    if not isinstance(results, list):
        return []
    valid_ids = {e["id"] for e in batch}
    out: list[dict[str, Any]] = []
    for r in results:
        if not isinstance(r, dict):
            continue
        rid = str(r.get("id", ""))
        if rid not in valid_ids:
            continue
        tag = r.get("tag", "noise")
        if tag not in ("opportunity", "important", "noise"):
            tag = "noise"
        out.append(
            {
                "id": rid,
                "tag": tag,
                "summary": (r.get("summary") or "")[:200],
                "complaint": (r.get("complaint") or None),
                "domain": (r.get("domain") or None),
            }
        )
    return out


def classify_emails(emails: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not emails:
        return []
    results: list[dict[str, Any]] = []
    for i in range(0, len(emails), EMAILS_PER_BATCH):
        batch = emails[i : i + EMAILS_PER_BATCH]
        results.extend(_classify_batch(batch))
        if i + EMAILS_PER_BATCH < len(emails):
            time.sleep(BATCH_SLEEP_SECONDS)
    return results


PAIN_MINER_SYSTEM = """You are a Micro-SaaS opportunity scout for an indie dev.

Input: a batch of user complaints from Reddit posts and personal email.
Each complaint has source, url, title, and body.

Task: cluster the complaints by underlying pain, then propose EXACTLY 5
distinct Micro-SaaS ideas.

Each idea MUST:
- Be buildable solo in 2-4 weeks. No biotech, no infra, no model training.
- Have a plausible PAYING user (B2B, prosumer, freelancer). Not consumer toys.
- Be DISTINCT from the other 4 in problem domain. No near-duplicates.
- Be rooted in actual complaints from the input — provide source URLs as evidence.

If the user provides a list of slugs to AVOID, do NOT propose anything that
resembles them — pick a different angle or different pain.

For each idea output:
- title: 2-6 word product name, in English.
- problem: 1 sentence describing the specific pain (in English).
- target_user: who pays — 1 short phrase.
- solution: 1-2 sentences on what the product does (in English).
- evidence: array of source URLs from the input (1-3 items).

Output STRICT JSON ONLY:
{"ideas": [{"title": "...", "problem": "...", "target_user": "...", "solution": "...", "evidence": ["..."]}, ...]}
No prose, no markdown, no commentary."""


IDEA_REVIEWER_SYSTEM = """You are a Micro-SaaS investor reviewing fresh ideas against current AI trends.

Input:
- `ideas`: a list of 5 ideas with title, problem, solution, target_user.
- `ai_trends`: a list of recent AI updates (titles + sources) — the current tech context.

For EACH idea, return verdict + reason in Hebrew:
- verdict: "approve" | "reject" | "pivot"
  - "approve": pain is real, idea is timely, AI trends do not eat it
  - "reject": pain is weak OR market saturated OR a current AI trend will commoditize it within 6 months
  - "pivot": pain is real but solution should change given current AI tech — give the pivot in 1 sentence
- reason: 1-2 sentences in Hebrew. Cite specific AI trends from the input when relevant.

Output STRICT JSON ONLY:
{"reviews": [{"title": "...", "verdict": "...", "reason": "..."}]}
No prose, no markdown."""


def review_ideas(
    ideas: list[dict[str, Any]], ai_trends: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not ideas:
        return []
    payload = {
        "ideas": [
            {
                "title": str(i.get("title", "")),
                "problem": str(i.get("problem", ""))[:500],
                "solution": str(i.get("solution", ""))[:500],
                "target_user": str(i.get("target_user", ""))[:200],
            }
            for i in ideas
        ],
        "ai_trends": [
            {
                "source": str(t.get("source", "")),
                "title": str(t.get("title", ""))[:200],
            }
            for t in ai_trends[:25]
        ],
    }
    parsed = ask_json(IDEA_REVIEWER_SYSTEM, payload, max_tokens=2000, temperature=0.3)
    reviews = parsed.get("reviews")
    if not isinstance(reviews, list):
        for v in parsed.values():
            if isinstance(v, list):
                reviews = v
                break
    if not isinstance(reviews, list):
        return []
    out: list[dict[str, Any]] = []
    for r in reviews:
        if not isinstance(r, dict):
            continue
        verdict = (r.get("verdict") or "").strip().lower()
        if verdict not in ("approve", "reject", "pivot"):
            verdict = "pivot"
        out.append(
            {
                "title": str(r.get("title", ""))[:200],
                "verdict": verdict,
                "reason": str(r.get("reason", ""))[:500],
            }
        )
    return out


def mine_ideas(
    complaints: list[dict[str, Any]],
    avoid_fingerprints: list[str] | None = None,
    max_inputs: int = 50,
) -> list[dict[str, Any]]:
    if not complaints:
        return []
    truncated = complaints[:max_inputs]

    user_payload: dict[str, Any] = {"complaints": truncated}
    if avoid_fingerprints:
        user_payload["avoid_slugs"] = list(avoid_fingerprints)[:40]

    parsed = ask_json(PAIN_MINER_SYSTEM, user_payload, max_tokens=2500, temperature=0.6)
    ideas = parsed.get("ideas")
    if not isinstance(ideas, list):
        for v in parsed.values():
            if isinstance(v, list):
                ideas = v
                break
    if not isinstance(ideas, list):
        return []

    out: list[dict[str, Any]] = []
    for i in ideas[:5]:
        if not isinstance(i, dict):
            continue
        title = str(i.get("title") or "").strip()
        problem = str(i.get("problem") or "").strip()
        solution = str(i.get("solution") or "").strip()
        if not title or not problem or not solution:
            continue
        evidence_raw = i.get("evidence") or []
        evidence = [
            str(e).strip()
            for e in (evidence_raw if isinstance(evidence_raw, list) else [evidence_raw])
            if str(e).strip()
        ][:5]
        out.append(
            {
                "title": title[:200],
                "problem": problem[:1000],
                "target_user": str(i.get("target_user") or "")[:200].strip(),
                "solution": solution[:1000],
                "evidence": evidence,
            }
        )
    return out


def ask_json(system: str, payload: Any, max_tokens: int = 2500, temperature: float = 0.5) -> dict[str, Any]:
    """One Groq call that must return a JSON object; callers validate the fields they use.

    Free tier is 8k tokens/minute, and several agents may share it, so a 429 waits out the window and retries.
    """
    for attempt in range(4):
        try:
            resp = groq().chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
                response_format={"type": "json_object"},
                temperature=temperature,
                max_tokens=max_tokens,
            )
            break
        except RateLimitError:
            if attempt == 3:
                raise
            time.sleep(25 * (attempt + 1))
        except BadRequestError as e:
            # gpt-oss sometimes emits slightly broken JSON (e.g. long Hebrew scripts); a cooler retry usually fixes it.
            if "json_validate_failed" not in str(e) or attempt == 3:
                raise
            temperature = max(0.2, temperature - 0.2)
    parsed = json.loads(resp.choices[0].message.content or "{}")
    return parsed if isinstance(parsed, dict) else {}
