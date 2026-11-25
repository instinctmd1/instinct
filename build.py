#!/usr/bin/env python3
"""Compile content/*.json into data.js (the game's question bank) and check every file.

Run:  python3 build.py            (uses content/)
      python3 build.py tests/fixtures   (uses another folder)
"""
import json, sys, pathlib, unicodedata, re

ORDER = ["bio", "econ", "gp", "eng", "math", "span", "tok"]
# units counted as "Current units" in the lobby (what each class is on / the next exam covers)
CURRENT = {
    "bio": ["a41", "a42"],
    "econ": ["u3", "exam"],
    "gp": ["myanmar", "external", "core", "papers"],
    "eng": ["u3", "u4", "u6"],
    "math": ["func", "model"],
    "span": ["u4", "u5", "u6"],
    "tok": ["ee", "ns"],
}
root = pathlib.Path(__file__).parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "content"

def norm(s):
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9.\-+%/^ ]+", " ", s)
    s = re.sub(r"^(the|a|an|el|la|los|las|un|una) ", "", " ".join(s.split()))
    return s

problems, subjects = [], []
files = sorted(src.glob("*.json"), key=lambda p: ORDER.index(p.stem) if p.stem in ORDER else 99)
for f in files:
    try:
        d = json.loads(f.read_text())
    except Exception as e:
        problems.append(f"{f.name}: invalid JSON ({e})"); continue
    unit_ids = {u["id"] for u in d.get("units", [])}
    seen_ids = set()
    for p in d.get("prompts", []):
        pid = p.get("id")
        if pid in seen_ids: problems.append(f"{f.name}: duplicate prompt id {pid}")
        seen_ids.add(pid)
        if p.get("unit") not in unit_ids: problems.append(f"{f.name} {pid}: unknown unit {p.get('unit')}")
        ans = p.get("answers", [])
        if len(ans) < 5: problems.append(f"{f.name} {pid}: only {len(ans)} answers")
        keys = {}
        for i, a in enumerate(ans):
            if a.get("tier") not in (1, 2, 3, 4, 5): problems.append(f"{f.name} {pid}: bad tier on {a.get('text')}")
            if not a.get("why"): problems.append(f"{f.name} {pid}: no 'why' on {a.get('text')}")
            for t in [a.get("text", "")] + list(a.get("alias", [])):
                k = norm(t)
                if k in keys and keys[k] != i:
                    problems.append(f"{f.name} {pid}: '{t}' matches two answers")
                keys[k] = i
    for q in d.get("quiz", []):
        if not (isinstance(q.get("answer"), int) and 0 <= q["answer"] < len(q.get("choices", []))):
            problems.append(f"{f.name}: quiz answer out of range: {q.get('q','')[:50]}")
        if len(q.get("choices", [])) != 4: problems.append(f"{f.name}: quiz needs 4 choices: {q.get('q','')[:50]}")
    for c in d.get("cards", []):
        if c.get("unit") not in unit_ids: problems.append(f"{f.name}: card with unknown unit: {c.get('front','')[:40]}")
    cur = [u for u in CURRENT.get(d.get('subject'), []) if u in unit_ids]
    if cur: d['current'] = cur
    subjects.append(d)
    print(f"{f.stem:5} prompts={len(d.get('prompts',[])):3} answers={sum(len(p['answers']) for p in d.get('prompts',[])):4} cards={len(d.get('cards',[])):3} quiz={len(d.get('quiz',[])):3}  units={[u['id'] for u in d.get('units',[])]}")

out = root / "data.js"
out.write_text("window.INSTINCT_DATA=" + json.dumps({"subjects": subjects}, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(f"\nwrote {out.name} ({out.stat().st_size/1024:.0f} KB)")
if problems:
    print(f"\n{len(problems)} problem(s):"); [print(" -", p) for p in problems]
    sys.exit(1)
print("all checks passed")
