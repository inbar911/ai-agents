"""The board style's script (18.11): a short dialogue. Noa, a curious guy, asks; Claude answers and draws on a whiteboard.
Rules come from Inbar's script playbook (vault: Knowledge/reels-script-playbook.md): human, specific, a misconception
as the hook, But/Therefore, the viewer's wrong guess as the re-hook, one everyday analogy, a callback ending."""
from __future__ import annotations

import json
import re
from typing import Any

from agents.channel.writer import research
from lib.gemini import gemini_json

ICONS = ["phone", "card", "reader", "cup", "bank", "cloud", "server", "database", "lock", "key", "person", "laptop", "wifi",
         "globe", "mail", "clock", "coin", "ticket", "shield", "chip", "house", "car", "battery", "bulb", "gear", "cart", "chat",
         "eye", "document", "robot", "magnet", "star", "heart", "fire", "satellite", "signal", "cash", "box"]
SLOTS = ["L", "C", "R", "BL", "BC", "BR", "TOP", "BOTTOM"]
# phrases of the 18.11 sample (tap to pay): a draft that copies them is rejected
STALE = ["4.80", "kiss the reader", "another coffee", "ticket that tears", "not your card number", "waved my phone at a box"]
TYPES = {"icon", "text", "big", "arrow", "cross", "check", "circle"}

EXPLAIN = """THE WHOLE POINT OF THE CHANNEL: AFTER 45 SECONDS THE VIEWER CAN EXPLAIN HOW IT WORKS TO A FRIEND.
(19.11, Inbar: the scripts sounded human but were not interesting and did not explain; one used "ETA" and nobody knew what it was.)
- Claude walks through the mechanism step by step, in the order it really happens: what happens first, what that
  causes, what happens next, until the end result. 3-5 steps. Each step is one Claude line that explains ONE thing in
  plain words, 8-16 words, a full sentence with a cause word (because / so / which means / that's why).
- Noa's lines stay short; Claude's explanation lines are full sentences, never one-word answers or fragments like
  "Encrypted. Scrambled." A one-word reply ("Nope.") is fine only as a reaction, followed by the real explanation.
- ZERO JARGON. Words a 12-year-old doesn't know are banned: no acronyms (ETA, GPS, API, AI model names, NFC...), no tech
  terms (encryption, servers, data center, algorithm, neural network, protocol, latency...). Say the everyday thing
  instead: "how long until you arrive", "turned into a secret code only your phone can read", "a giant room of
  computers". If the topic itself needs one term, explain it in the same line in everyday words the first time.
- No name-dropping as an explanation: "Google uses DeepMind's Graph Neural Networks" explains nothing. Say what it DOES.
- Interesting = a surprise in every step: something the viewer didn't expect about their own phone, money or friends.
- Before the end, one line (Noa's) sums up the whole mechanism in a few everyday words, so the viewer feels "I get it"."""

RULES = """HOW IT MUST SOUND (this matters more than anything; scripts that "sound like AI" are rejected):
- It is a real conversation between two friends, not a lecture read in two voices.
- Line 1 is Noa in the middle of a real, specific moment from a teenager's day WITH THIS TOPIC: a real object, a real
  number or a real situation that belongs to this topic only. Never "Did you know" or "Have you ever".
- Claude's first answer breaks the misconception most people have about THIS topic. That reversal is the hook.
- Structure every beat as cause-and-effect or a turn (each answer opens the next question). This is a structure:
  never write the words "Therefore" or "Thus"; people say "so", "which means", "wait", "okay but".
- Noa guesses wrong at least once; Claude's "Nope." to the wrong guess is the re-hook.
- One everyday analogy for the hardest step, visual and a bit funny, invented for THIS topic.
- Noa reacts like a real person at least once: a joke, a worry, disbelief.
- Specific beats general: real numbers and names from the researched facts.
- Short spoken lines, 2-14 words each, contractions, fragments. Read it aloud: if a friend wouldn't say it, rewrite it.
- The last line is Noa's and calls back to line 1 with a joke or a twist. No "follow for more", no summary, no moral.
- BANNED (AI tells): "Here's the thing", "Here's the clever part", "Let's dive in", "game-changer", "seamless",
  "In today's world", "Imagine", "magic", "simply put", "Therefore", lists of three, "But here's the twist",
  "it's that simple", "and that's how", "In conclusion", any line that repeats what was just said.
- Every line is ORIGINAL for this topic. Never reuse a line, joke, number or analogy from any other video.
- Every fact must be true. Use only the researched facts for numbers and claims."""

BOARD = """THE WHITEBOARD: Claude draws on a 1600x1000 board while he talks. Split the video into 3-4 PANELS (the board is
wiped between panels). Each panel has 3-7 ITEMS. Each item is drawn exactly on a spoken word: "at": {"line": "<line id>",
"word": "<a word that literally appears in that line>"}. Items in a panel must follow the dialogue order.
Item types:
- {"type":"icon","id":"<short id>","icon":"<one of ICONS>","slot":"<slot>","label":"<1-3 words, optional>","at":{...}}
- {"type":"text","id":"...","text":"<max 22 chars>","slot":"<slot>","color":"black|blue|orange","at":{...}}
- {"type":"big","id":"...","text":"<max 8 chars: the one key word or number of this topic>","slot":"<slot>","at":{...}}
- {"type":"arrow","from":"<item id>","to":"<item id>","label":"<optional, max 12 chars>","at":{...}}
- {"type":"cross","target":"<item id>","at":{...}}  (crossing something out: "Nope", "not", "useless")
- {"type":"check","target":"<item id>","at":{...}}  (a yes / approved)
- {"type":"circle","target":"<item id>","at":{...}} (this is the important one)
SLOTS (never two icons/texts in the same slot of one panel): L C R (top row), BL BC BR (bottom row), TOP and BOTTOM
(full-width text rows: use them for a long number or a short sentence).
ICONS: {icons}. Pick the icon that IS the thing (phone for a phone). If none fits, use "box" with a short "text".
Put a "big" item on the 1-2 most important words of the video only. Draw what is said, as it is said."""


JARGON = re.compile(r"\b[A-Z]{2,5}s?\b|(?i:\b(?:encrypt\w*|server\w*|data ?cent(?:er|re)s?|algorithm\w*|neural|protocol\w*|latency|"
                    r"bandwidth|metadata|machine learning|infrastructure|geographically|at rest|anonymi[sz]ed|real-time)\b)")
OK_CAPS = {"OK", "AI", "TV", "PM", "AM", "I", "USA", "UK", "LOL", "OMG"}


def jargon(lines: list[dict[str, Any]]) -> list[str]:
    """Words a teen wouldn't know, unless the same line explains them (a dash, "which means", "like", "basically")."""
    out = []
    for L in lines:
        explained = re.search(r"[—–-] |which means|basically|like a|meaning", L["text"], re.I)
        for m in JARGON.finditer(L["text"]):
            w = m.group(0)
            if w.upper() in OK_CAPS or (w.isupper() and len(w) <= 1) or explained:
                continue
            out.append(w)
    return sorted(set(out))


def _prompt(topic: str, facts: list[str], notes: str | None) -> str:
    return f"""Write a 35-50 second Instagram Reel as a dialogue that explains: {topic}
Researched facts (use ONLY these for claims and numbers):
{chr(10).join(f"- {f}" for f in facts) or "- (no research available: keep claims general and certainly true)"}
{f"A reviewer watched the previous version; keep the same topic and idea but fix this: {notes}" if notes else ""}
The two characters: NOA, a curious teenage guy (the viewer's voice: confused, skeptical, funny), and CLAUDE, a small
friendly orange AI who explains with a grin and a pointer. 12-18 lines, 90-130 words in total, alternating mostly
(Claude may have two lines in a row once).
{EXPLAIN}
{RULES}
{BOARD.replace("{icons}", ", ".join(ICONS))}
For every line also give "emotion": 2-6 ADJECTIVES for how it is said (e.g. "skeptical, quick").
Only adjectives: never stage directions such as "pause", "beat", "silence", "laughs", "sighs" (the voice reads them aloud).
Return JSON only:
{{"title": "<4-8 word hook title for the post>", "board_title": "<the question on the board, max 30 chars>",
"caption": "<2-3 casual sentences for the Instagram caption, ending with a question to the viewers>",
"hashtags": ["#...", 5-8 tags],
"lines": [{{"id": "l01", "speaker": "noa", "text": "...", "emotion": "..."}}, ...],
"panels": [{{"items": [ ... ]}}, ...]}}"""


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def validate(s: Any, strict: bool = True) -> dict[str, Any]:
    if not isinstance(s, dict) or not isinstance(s.get("lines"), list):
        raise ValueError("no lines")
    lines = []
    for i, L in enumerate(s["lines"]):
        text = str(L.get("text", "")).strip()
        if not text:
            continue
        emo = re.sub(r"\b(pause|beat|silence|laugh\w*|sigh\w*|whisper\w*)\b", "", str(L.get("emotion", "")), flags=re.I)
        lines.append({"id": f"l{i + 1:02d}", "speaker": "noa" if str(L.get("speaker", "")).lower().startswith("n") else "claude",
                      "text": text, "emotion": re.sub(r"\s*,\s*,+", ",", emo).strip(" ,") or "natural, warm", "_old": L.get("id")})
    if not 8 <= len(lines) <= 22:
        raise ValueError(f"{len(lines)} lines")
    words = sum(len(L["text"].split()) for L in lines)
    if not 55 <= words <= 165:
        raise ValueError(f"{words} words (keep it to 90-130)")
    bad = jargon(lines)
    if bad and strict:   # the last try is let through rather than losing the video
        raise ValueError(f"jargon a 12-year-old won't know, say the everyday thing instead: {', '.join(bad)}")
    stale = [p for p in STALE if p in " ".join(L["text"].lower() for L in lines)]
    if stale:
        raise ValueError(f"reused lines from the sample video: {stale}")
    remap = {L["_old"]: L["id"] for L in lines}
    by_id = {L["id"]: L for L in lines}
    panels = []
    for p in (s.get("panels") or [])[:5]:
        items, ids = [], set()
        for it in (p.get("items") or [])[:8]:
            if it.get("type") not in TYPES:
                continue
            a = it.get("at") or {}
            line = remap.get(a.get("line"), a.get("line"))
            if line not in by_id:
                continue
            word = str(a.get("word", ""))
            if _norm(word) and _norm(word) not in _norm(by_id[line]["text"]):
                word = by_id[line]["text"].split()[0]
            it = {**it, "at": {"line": line, "word": word}}
            if it["type"] in ("icon", "text", "big"):
                if it.get("slot") not in SLOTS or not it.get("id"):
                    continue
                if it["type"] == "icon" and it.get("icon") not in ICONS:
                    it["icon"] = "box"
                ids.add(it["id"])
            elif it["type"] == "arrow" and not (it.get("from") in ids and it.get("to") in ids):
                continue
            elif it["type"] in ("cross", "check", "circle") and it.get("target") not in ids:
                continue
            items.append(it)
        if items:
            panels.append({"items": items})
    if len(panels) < 2:
        raise ValueError("board has fewer than 2 panels")
    for L in lines:
        L.pop("_old")
    tags = [t if str(t).startswith("#") else f"#{t}" for t in (s.get("hashtags") or [])][:8]
    return {"title": str(s.get("title") or "").strip()[:80], "board_title": str(s.get("board_title") or s.get("title") or "")[:30],
            "caption": str(s.get("caption") or "").strip(), "hashtags": tags, "lines": lines, "panels": panels}


def write_script(topic: str, notes: str | None = None) -> dict[str, Any]:
    found = research(topic)
    last: Exception | None = None
    for attempt in range(3):
        try:
            # a rejected draft's reason goes back to the writer, so the next try fixes it instead of guessing
            fix = "; ".join(x for x in (notes, f"Your last draft was rejected: {last}" if last else None) if x) or None
            s = validate(gemini_json(_prompt(topic, found["facts"], fix), .85), strict=attempt < 2)
            return {**s, "sources": found["sources"]}
        except Exception as e:  # noqa: BLE001 — a broken draft gets another try
            last = e
            print(f"[board] script draft {attempt + 1} rejected: {e}")
    raise RuntimeError(f"no usable board script: {last}")


if __name__ == "__main__":
    import sys
    print(json.dumps(write_script(" ".join(sys.argv[1:]) or "how does tap to pay work"), indent=1, ensure_ascii=False))
