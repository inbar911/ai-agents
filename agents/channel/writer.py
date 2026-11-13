"""Gemini writes the channel's videos: fresh tech topics and a hooked Hebrew or English script for the neon engine
(engine/world.js). Each line names the 3D object the camera flies to and what happens there; every model output
is shape-checked against the engine's object and action lists before it reaches the renderer."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx

from agents.channel.igkit import hookscore, humanize
from lib.bot_data import bot_secret
from lib.memory import learned

MOODS = {"pop", "lofi", "electro", "chill", "trap"}
MODEL = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"
MODELS = ["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"]

# Must match OBJ, SYM and ACT in engine/world.js.
OBJECTS = ["phone", "phone_ultra", "laptop", "soda_can", "cardboard_box", "router", "earbuds", "watch", "tv", "server", "chip", "tower", "satellite", "cloud", "globe",
           "lock", "charger", "controller", "controller_ps", "console_ps", "console_xbox", "pc_tower", "car", "house"]
SYMBOLS = ["wifi", "bluetooth", "signal", "pin", "battery", "bell", "heart", "check", "cross", "bolt", "eye", "chat", "play",
           "gear", "shield", "fingerprint", "sound", "camera_icon"]
# the model library (engine/models): ~130 CC0 / NASA models, each with tags the writer picks from
CATALOG = json.loads((Path(__file__).parent / "engine" / "models" / "catalog.json").read_text(encoding="utf-8"))
LIBRARY = sorted(CATALOG)
VISUALS = set(OBJECTS) | set(SYMBOLS) | set(LIBRARY)
ENVS = {"city", "home", "space", "studio"}   # ENV in engine/world.js
ACTIONS = {
    "show": "the camera just arrives at the object",
    "pulse": "the object throbs once (attention, 'this one')",
    "spin": "the object turns around (looking at it from all sides)",
    "waves": "signal rings spread out of the object (broadcasting, wireless, sound)",
    "beam": "a stream of glowing dots flows from focus to target (data / signal / power travelling); needs target",
    "explode": ("the object comes apart in layers so the viewer sees what's inside and how it's built, then closes again. "
                "YOU decide if it fits: only when the line is about what's inside the object or how it works inside, and the object "
                "really has an inside worth showing (a phone, a chip, a laptop, a battery...). A line about what a truck carries, "
                "a car driving or a building's size does NOT come apart: use show/spin/pulse there. Usually once per video at most"),
    "count": "a big number counts up above the object; needs value (number) and optional suffix like '%', 'x', '+'",
    "yes": "a check mark appears (it works / the answer)",
    "no": "a red X appears (myth / wrong / blocked)",
}


def _gemini(prompt: str, temperature: float = 0.9) -> Any:
    key = bot_secret("gemini_key")
    if not key:
        raise RuntimeError("missing bot secret: gemini_key")
    # flash is often briefly overloaded (503); retry it, then fall back to flash-lite
    for i, model in enumerate(MODELS):
        r = httpx.post(MODEL.format(model), headers={"x-goog-api-key": key}, timeout=180, json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": temperature},
        })
        if r.status_code in (429, 500, 503) and i < len(MODELS) - 1:
            time.sleep(15 * (i + 1))   # overloads can last minutes; this waits ~5 min in total
            continue
        r.raise_for_status()
        try:
            return json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
        except (KeyError, ValueError):
            continue
    raise RuntimeError("gemini returned no usable JSON")


def research(topic: str) -> dict[str, Any]:
    """Before writing: Gemini searches Google (grounding) and returns a few checked facts plus the sites it used,
    so the script's claims and numbers come from sources rather than the model's memory. Empty on failure."""
    key = bot_secret("gemini_key")
    if not key:
        return {"facts": [], "sources": []}
    body = {
        "contents": [{"parts": [{"text": f"""Research this for a short explainer video: {topic}
Search the web and give 4-6 short, verified facts in plain English that explain how it really works, including one
surprising fact or real number if a reliable source states it. Only facts your search results support.
Answer as plain lines, each starting with "FACT: "."""}]}],
        "tools": [{"google_search": {}}],
    }
    for i, model in enumerate(["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]):
        try:
            r = httpx.post(MODEL.format(model), headers={"x-goog-api-key": key}, timeout=120, json=body)
            if r.status_code in (429, 500, 503) and i < 2:
                time.sleep(15 * (i + 1))
                continue
            r.raise_for_status()
            cand = r.json()["candidates"][0]
            text = "".join(p.get("text", "") for p in cand["content"]["parts"])
            facts = [line.split("FACT:", 1)[1].strip() for line in text.splitlines() if "FACT:" in line][:6]
            chunks = cand.get("groundingMetadata", {}).get("groundingChunks", [])
            sources = list(dict.fromkeys(c["web"]["title"] for c in chunks if c.get("web", {}).get("title")))[:5]
            return {"facts": facts, "sources": sources}
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
            print(f"[channel] research failed ({model}): {e}", file=sys.stderr)
    return {"facts": [], "sources": []}


LANG_NAME = {"he": "Hebrew", "en": "English"}


def pick_topics(n: int, done: list[str], request: str, lang: str = "he") -> list[str]:
    out = _gemini(f"""You pick topics for a {LANG_NAME[lang]} Instagram Reels channel of faceless animated explainers:
"how does X actually work" — ONLY technology a teenager touches every day: phones, apps, internet, gaming,
AI, social media, gadgets (e.g. how AirDrop works, how Face ID knows it's you, how TikTok knows what you like,
how a phone charges without a cable). No science, food or body topics. Topics must be explainable
in 20-30 seconds with NO technical words and have a surprising answer that a teenager would want to share.
{f'Inbar asked for: {request}. Follow it.' if request else ''}
Already made (never repeat or paraphrase): {json.dumps(done[-80:], ensure_ascii=False)}
Return JSON only: {{"topics": ["<topic in {LANG_NAME[lang]}>", ...]}} with exactly {n} topics.""" + learned("channel"))
    topics = [t.strip() for t in out.get("topics", []) if isinstance(t, str) and t.strip()]
    if not topics:
        raise RuntimeError("no topics")
    return topics[:n]


HEBREW = """Spoken Israeli Hebrew, very short sentences, 4-12 words per line, 60-90 words total.
Always talk to the viewers in PLURAL (אתם, שלכם, לכם, אתכם, תדמיינו), never singular (אתה/את, שלך, לך), so the voice
never guesses a gender wrong.
Write brand names in Hebrew letters as they are pronounced (איירדרופ, ווייפיי, בלוטות'), because a Hebrew voice reads it.
Hook patterns that work: "הטלפון שלכם מקשיב לכם עכשיו?", "אתם עושים את זה 100 פעם ביום", "הסוד שגוגל לא מספרים לכם".
Last line: a short question + the single word "*תעקבו*." (e.g. "אוהבים סודות כאלה? *תעקבו*."). Always exactly "תעקבו",
never "תעקבו אחרינו", "תעקבו אחריי" or "עקבו".
For every line also give "say": the exact same line with full Hebrew niqqud (no asterisks), so the voice reads every
word right. Only the vowels are added, never a word changed."""
ENGLISH = """Casual spoken American English, very short sentences, 4-12 words per line, 65-95 words total.
Hook patterns that work: "Your phone is listening right now.", "You do this 100 times a day.", "Google never tells you this."
Last line: a short question + the single word "*Follow*." (e.g. "Want more secrets like this? *Follow*.")."""


SAY = ' "say": "<the same line with full niqqud>",'
REMAKE = """A reviewer watched the previous version of this Reel and it was not good enough. Keep the SAME topic and the same idea
(do not switch to a different subject or angle); make this version better by fixing exactly this:
{}
"""

CANDIDATES = """Inbar reviewed this idea and has 3 candidate hooks for it:
{}
Judge them against the hook rules below: use the strongest one as the hook (you may tighten its wording, keep its formula),
unless you write one that is clearly stronger. Put the other two in "hook_options"."""

# Hook formulas from the instagram-agent skill (igkit/hooks.json, MIT) that fit faceless tech explainers.
_HOOKS = {h["id"]: h for h in json.loads((Path(__file__).parent / "igkit" / "hooks.json").read_text(encoding="utf-8"))["hooks"]}
HOOK_FORMULAS = "\n".join(f"   - {_HOOKS[i]['name']}: {_HOOKS[i]['template']} (trap: {_HOOKS[i]['trap']})"
                          for i in (18, 10, 3, 7, 23, 26, 22)) + (
    "\n   - Hidden Feature: Hidden {thing} inside your {device you own}. (ThioJoe-style; trap: a 'secret' everybody knows)"
    "\n   Research (ig-viral, 7.11, 30 Shorts from 5 tech/science channels): the outliers open MID-ACTION on the thing"
    "\n   itself ('if you shine a laser through a fan...', 'Hidden Emergency Restart in Windows'), so the first frame"
    "\n   already shows what the line says. Prefer Cold Open Demo, If This, and Hidden Feature.")
_SLOP = humanize.load_lexicon()


def _clean(text: str) -> str:
    """English copy without the AI fingerprint: em dashes, invisible characters, stock phrases."""
    return humanize.humanize(text, _SLOP)[0].strip()


def _hook_score(text: str) -> float:
    return hookscore.run(text.replace("*", ""))[1]


def _best_hook(segs: list[dict[str, Any]], options: Any) -> None:
    """English only (the scorer reads English): swap in an alternative hook if it scores higher than the written one."""
    alts = [o.strip() for o in options if isinstance(o, str) and 4 <= len(o.split()) <= 12] if isinstance(options, list) else []
    best = max([segs[0]["text"], *alts], key=_hook_score)
    # The scorer rewards "you + stakes + number"; the niche's real outliers (ig-viral, 7.11) are visual demos it
    # scores 34-43. So it only rescues a truly generic hook (under 30) and never overrides a demo hook.
    print(f"[channel] hook scores: {[(round(_hook_score(h)), h) for h in [segs[0]['text'], *alts]]}", file=sys.stderr)
    if best != segs[0]["text"] and _hook_score(segs[0]["text"]) < 30 and _hook_score(best) >= _hook_score(segs[0]["text"]) + 15:
        print(f"[channel] hook {_hook_score(segs[0]['text']):.0f} -> {_hook_score(best):.0f}: {best}", file=sys.stderr)
        if "*" not in best:   # the headline colours the key word: a number if there is one, else the longest word
            words = best.split()
            k = next((i for i, x in enumerate(words) if any(c.isdigit() for c in x)), max(range(len(words)), key=lambda i: len(words[i].strip(".,?!"))))
            words[k] = f"*{words[k].strip('.,?!')}*" + words[k][len(words[k].rstrip('.,?!')):]
            best = " ".join(words)
        segs[0]["text"] = best


def write_script(topic: str, lang: str = "he", hooks: list[str] | None = None, notes: str | None = None) -> dict[str, Any]:
    actions = "\n".join(f"- {k}: {v}" for k, v in ACTIONS.items())
    found = research(topic)
    facts = ("Researched facts (from a web search) — build the explanation ONLY on these; never add a number or claim "
             "that is not here:\n" + "\n".join(f"- {f}" for f in found["facts"])) if found["facts"] else ""
    prompt = f"""Write a 20-30 second {LANG_NAME[lang]} Instagram Reel script that explains: {topic}
{facts}
{CANDIDATES.format(chr(10).join(f"- {h}" for h in hooks)) if hooks else ""}
{REMAKE.format(notes) if notes else ""}
Who watches: a 16-year-old scrolling fast who knows NOTHING technical and will swipe away the moment it gets boring.
The video is ONE dark neon hologram world that tells the story: the real objects involved stand in it as glowing 3D
models, the camera flies to the object each line talks about, and the objects interact (a router beams data to the
phone, a tower sends waves). When the story comes back to an object, use the same object again (the router stays
the router). But keep the picture moving: a DIFFERENT model on most lines, never more than 2 lines in a row on the
same model, and at least 5 different models in the video (the parts of the process: where it starts, what carries it,
what receives it, who uses it). A fact about one thing (a number, an ID, a code) goes on a related model with a symbol
or a count, not on the same object again and again. For each line also pick a "symbol" that pops up over the object to show what the line says: the line
says "Wi-Fi" → wifi over the router; "password" → lock over the phone; "signal" → signal; "notification" → bell.
Only when the line literally names that thing: no symbol is better than a decorative one (never an eye or a gear just
to fill the frame), at most 3 in a video.
Pick the visuals that show exactly what each line is about.
Rules that matter more than anything:
- ZERO jargon. If an idea needs a technical term, replace it with an everyday picture.
- Every line must create a small "wait, what?" or move the story forward. No filler, no textbook tone.
- Talk TO the viewer ("you", "your phone", "right now") like a friend telling a crazy secret, with energy.
- EXPLAIN, don't list. Never "X does this. Y does that." Walk the viewer through what actually happens, step by
  step, in the order it happens, and say WHY each step happens, with cause words ("because", "so", "which means",
  "that's how"). Give the hard step one everyday picture (the router shouts in light waves, the chip is a tiny
  bouncer checking IDs). After the video the viewer must be able to explain to a friend HOW it works, not just WHAT.
  Bad: "Your phone sends a signal. The tower receives it." Good: "Your voice becomes *waves*, so the tower can catch it."
Structure:
1. hook: 5-9 words, shown as a giant headline from the first frame. Most viewers swipe away within 2-3 seconds,
   so it must be understood in ONE second, talk to "you", hit something the viewer owns or does every day, and carry
   a threat, a secret or a concrete number. Build it on one of these proven formulas:
{HOOK_FORMULAS}
   Our own numbers (ig-audit, 7.11, 10 reels): the best reel opened on a big counted number ("80% of what you
   watch...", skip 34%, 7s watched); vague "the secret your phone keeps" lost 93% in the first second. So when a
   researched fact has a number, the hook says that number and its line uses action "count" with that value.
   Don't put "Secret" in every title: vary the title words.
   Never a soft or generic opener ("ever wondered how Wi-Fi works?", "in this video", "let's talk about").
   Also give "hook_options": 2 MORE hooks for the same script, each on a DIFFERENT formula, same rules, with one
   *key word* each. The best-scoring of the three is used.
2. tease: one short line that makes the hook worse or weirder (a number, "and you allowed it", "every 3 seconds").
3. 3-5 lines that explain HOW it works as a chain of cause and effect: each line is the next step and why it
   happens, each a new mini-reveal; before the last reveal a line like "but that's not the crazy part".
4. payoff: one line that makes it click ("so that's why...") and repeats one key word from the hook, so the replay
   loops back into the hook cleanly.
5. last: the follow line below.
Pace: max 8 words per line (10 for an explain line that needs its "because"), 8-10 lines, 70-85 words in total,
20-28 seconds. Hard limit 30 seconds: anything longer is sped up. Every line must change something on screen (a new object, a
beam, a count, an explosion); never two "show" lines in a row.
Voice: loud, clear and energetic. A whisper is allowed on at most 2 lines, only where it fits (a creepy reveal),
never on the hook or the last line.
{HEBREW if lang == "he" else ENGLISH}
Mark exactly ONE whole key word per line with *asterisks*. Facts must be correct.

3D objects (detailed, prefer these for devices): {", ".join(OBJECTS)}
(controller = Xbox-style gamepad, controller_ps = PlayStation-style gamepad, console_ps / console_xbox = the console box
itself, pc_tower = a gaming PC with a glass side. A line about a console shows the console, not a controller.)
More 3D models, pick the one that shows the line exactly (name: what it is): {"; ".join(f"{n}: {', '.join(CATALOG[n]['tags'][:3])}" for n in LIBRARY)}
3D symbols: {", ".join(SYMBOLS)}
What can happen at a line's visual:
{actions}

Return JSON only:
{{"title": "<short {LANG_NAME[lang]} title that makes people curious>",
  "caption": "<Instagram caption in {LANG_NAME[lang]}. The video already hooks, so the caption is NOT a second hook.
              First 125 characters: one plain line of what they learn + ONE question that invites comments (the only ask).
              Then 1-2 short lines that use 2-3 phrases people would type into Instagram search for this topic, in normal
              sentences. No links, no hashtags, no emoji as the first character, no 'follow for more' / 'stop scrolling'.>",
  "hashtags": ["#...", 3-5 specific topic hashtags; never #viral #fyp #explorepage #foryou],
  "hook_options": ["<another hook, different formula>", "<another hook, different formula>"],
  "mood": "<background beat that fits the topic: pop | lofi | electro | chill | trap>",
  "env": "<the world the story happens in: city (streets, buildings, cars: networks, phones on the move, GPS, deliveries) | home (a room: appliances, furniture, things at home) | space (stars and orbit: satellites, GPS, the internet around the planet) | studio (a plain dark stage, when none fits)>",
  "segments": [{{"text": "<line>", "tone": "<English voice direction: energetic, amazed, playful, dramatic...>",{SAY if lang == "he" else ""}
                 "focus": "<object (or a symbol when no object fits)>", "symbol": "<symbol shown over it, optional>", "action": "<action>", "target": "<object, only for beam>",
                 "label": "<optional 1-2 words floating over it>", "value": <number, only for count>,
                 "suffix": "<only for count>"}}]}}"""
    script = _valid_script(_gemini(prompt), lang)
    problem = _variety_problem(script["segments"])
    if problem:   # one rewrite: a video stuck on one model looks empty (Inbar on #43: a soda can on 8 of 11 lines)
        print(f"[channel] variety: {problem}; rewriting", file=sys.stderr)
        retry = _valid_script(_gemini(prompt + f"\n\nYour last script broke the variety rule: {problem}. Rewrite it with more different models."), lang)
        if not _variety_problem(retry["segments"]) or _distinct(retry["segments"]) > _distinct(script["segments"]):
            script = retry
    return {**script, "lang": lang, "sources": found["sources"], "researched": bool(found["facts"])}


def _distinct(segs: list[dict[str, Any]]) -> int:
    return len({s["focus"] for s in segs})


def _variety_problem(segs: list[dict[str, Any]]) -> str | None:
    """None when the script keeps the picture moving: at least 5 models (or one per 2 lines in a short one), no 3 lines in a row on one."""
    need = min(5, (len(segs) + 1) // 2)
    if _distinct(segs) < need:
        return f"only {_distinct(segs)} different models in {len(segs)} lines (need {need})"
    for i in range(len(segs) - 2):
        if segs[i]["focus"] == segs[i + 1]["focus"] == segs[i + 2]["focus"]:
            return f"'{segs[i]['focus']}' on 3 lines in a row (lines {i + 1}-{i + 3})"
    return None


def _gaming(seg: dict[str, Any], text: str) -> None:
    """A console line shows the console and a controller line the controller, of the brand the line names."""
    t = text.lower()
    if seg["focus"] not in {"controller", "controller_ps", "console_ps", "console_xbox"}:
        return
    ps = any(k in t for k in ("playstation", "ps5", "ps4", "dualsense", "פלייסטיישן"))
    pad = any(k in t for k in ("controller", "gamepad", "joystick", "שלט", "ג'ויסטיק"))
    console = any(k in t for k in ("console", "קונסול"))
    if pad or not console and seg["focus"].startswith("controller"):
        seg["focus"] = "controller_ps" if ps else "controller" if "xbox" in t else seg["focus"] if seg["focus"].startswith("controller") else "controller"
    else:
        seg["focus"] = "console_ps" if ps else "console_xbox" if "xbox" in t else seg["focus"] if seg["focus"].startswith("console") else "console_ps"


NOISE = {"eye", "gear", "heart", "pulse"}   # symbols the writer used as decoration, unrelated to the line

FOLLOW = {"he": ("*תעקבו*.", "אוהבים סודות כאלה? *תעקבו*.", ("תעקבו", "עקבו")),
          "en": ("*Follow*.", "Want more secrets like this? *Follow*.", ("follow",))}


def _follow_line(text: str, lang: str = "he") -> str:
    """Every video ends the same way: a short question, then exactly the one word (Hebrew: "תעקבו", never "אחרינו")."""
    word, fallback, stems = FOLLOW[lang]
    i = text.find("?")
    question = text[: i + 1].strip() if i > 0 else ""
    if not any(st in text.lower() for st in stems) or not question or any(st in question.lower() for st in stems):
        return fallback
    return f"{question} {word}"


def _bare(t: str) -> str:
    """The line without niqqud, asterisks or spacing differences: "say" must be the same words as "text"."""
    return " ".join(re.sub(r"[֑-ׇ*]", "", t).split())


def _valid_script(s: Any, lang: str = "he") -> dict[str, Any]:
    if not isinstance(s, dict) or not isinstance(s.get("segments"), list):
        raise RuntimeError("script has no segments")
    segs, whispers = [], 0
    for x in s["segments"]:
        if not (isinstance(x, dict) and isinstance(x.get("text"), str) and 2 <= len(x["text"].split()) <= 30):
            continue
        tone = str(x.get("tone") or "energetic")[:120]
        # viewers found a whispering narrator annoying: at most 2 whispered lines, never the hook
        if any(w in tone.lower() for w in ("whisper", "hush", "secret", "quiet", "soft", "murmur")):
            if segs and whispers < 2:
                whispers += 1
            else:
                tone = "energetic, clear, amazed"
        seg = {"text": x["text"], "tone": tone,
               "focus": x.get("focus") if x.get("focus") in VISUALS else (segs[-1]["focus"] if segs else "phone"),
               "action": x.get("action") if x.get("action") in ACTIONS else "show"}
        if seg["action"] == "beam":
            if x.get("target") in VISUALS and x["target"] != seg["focus"]:
                seg["target"] = x["target"]
            else:
                seg["action"] = "waves"
        if seg["action"] == "count":
            if isinstance(x.get("value"), (int, float)):
                seg["value"], seg["suffix"] = x["value"], str(x.get("suffix") or "")[:3]
            else:
                seg["action"] = "pulse"
        _gaming(seg, x["text"])
        if x.get("symbol") in SYMBOLS and x["symbol"] != seg["focus"]:
            seg["symbol"] = x["symbol"]
        if lang == "he" and isinstance(x.get("say"), str) and _bare(x["say"]) == _bare(x["text"]):
            seg["say"] = x["say"].replace("*", "")
        if isinstance(x.get("label"), str) and 0 < len(x["label"]) <= 16:
            seg["label"] = x["label"]
        segs.append(seg)
    if not 5 <= len(segs) <= 12:
        raise RuntimeError(f"script has {len(segs)} usable segments")
    last = _follow_line(segs[-1]["text"], lang)
    if last != segs[-1]["text"]:
        segs[-1].pop("say", None)
    segs[-1].update(text=last, tone="warm, friendly, loud and clear")
    # the follow line ends on the video's main object (the follow card pops up over it), never a random figure
    objs = [x["focus"] for x in segs[:-1] if x["focus"] not in SYMBOLS and x["focus"] != "human_figure"]
    if objs:
        segs[-1].update(focus=max(set(objs), key=objs.count), action="spin")
        segs[-1].pop("symbol", None); segs[-1].pop("target", None)
    # a symbol pops up only when it shows what the line says; the generic ones (an eye, a gear) were thrown in at random
    shown = 0
    for x in segs:
        if x.get("symbol") in NOISE or shown >= 3:
            x.pop("symbol", None)
        elif x.get("symbol"):
            shown += 1
    title, caption = str(s.get("title") or "")[:80], str(s.get("caption") or "")[:1500]
    if lang == "en":
        _best_hook(segs, s.get("hook_options"))
        for seg in segs:
            seg["text"] = _clean(seg["text"])
        title, caption = _clean(title), _clean(caption)
    dead = {"#viral", "#fyp", "#explorepage", "#foryou", "#foryoupage"}
    return {
        "title": title or ("סרטון" if lang == "he" else "Video"),
        "caption": caption,
        "hashtags": [h for h in s.get("hashtags", []) if isinstance(h, str) and h.startswith("#") and h.lower() not in dead][:5],
        "segments": segs,
        "mood": s.get("mood") if s.get("mood") in MOODS else "electro",
        "env": s.get("env") if s.get("env") in ENVS else "studio",
    }
