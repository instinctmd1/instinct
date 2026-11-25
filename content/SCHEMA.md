# Instinct — content rules (read fully before writing)

Instinct is a multiplayer study party game for an IB Diploma Year 1 student (Grade 11, school year started Aug 2026).
Main mode: everyone sees the same prompt ("Name a non-price determinant of demand") and has 45 seconds to type
as MANY correct answers as they can. Each correct answer scores by RARITY tier (obvious answers score little,
deep cuts score a lot). If two players give the same answer they split its points, so players are rewarded for
knowing the less-obvious material. After each round, the full answer board is revealed with a one-line
explanation of every answer — that is where the learning happens. There are also solo Flashcards and a Quiz mode.

## Output: ONE JSON file, valid JSON (no comments, no trailing commas), UTF-8

```json
{
  "subject": "econ",                      // fixed code given in your brief
  "name": "Economics",                    // short display name
  "units": [ {"id": "u3", "name": "Elasticities (PED, YED, PES)"} ],
  "prompts": [
    {
      "id": "econ-01",
      "unit": "u3",
      "prompt": "Name a determinant of price elasticity of demand",
      "answers": [
        {"text": "Number of substitutes", "alias": ["substitutes", "availability of substitutes", "closeness of substitutes"], "tier": 1,
         "why": "More close substitutes = consumers switch easily = more elastic demand."}
      ]
    }
  ],
  "cards": [ {"unit": "u3", "front": "PED formula", "back": "%Δ quantity demanded ÷ %Δ price"} ],
  "quiz": [ {"unit": "u3", "q": "PED = −0.4 means demand is…", "choices": ["Price inelastic", "Price elastic", "Unit elastic", "Perfectly elastic"],
             "answer": 0, "explain": "|PED| < 1, so quantity changes proportionally less than price."} ]
}
```

## Prompts (the heart of the game) — aim for 25–35 per subject
- Always "Name a/an ___" (or "Nombra un/una ___" style for Spanish if natural; English instruction is fine). Must have MANY valid short answers:
  6–16 answers per prompt. Every answer must be typeable in 1–4 words (a term, name, number, word — never a sentence).
- `tier` 1–5 = how obvious the answer is to a typical classmate:
  1 = the first thing most of the class would say; 2 = solid; 3 = good recall; 4 = rare, shows real depth; 5 = deep cut almost nobody gets.
  Each prompt needs at least one tier-1, at least two tier 2–3, and ideally one tier 4–5. Spread them honestly.
- `alias`: lowercase alternative spellings / synonyms / abbreviations / singular-plural / common misspellings / no-accent versions
  that should also count. The game already ignores case, accents, punctuation, a leading "the/a/an/el/la/los/las", trailing "s",
  and small typos (1 letter for words ≥5 chars, 2 for ≥9), so only add aliases that are genuinely different wordings.
  Do NOT put an alias on two different answers in the same prompt (no ambiguity).
- `why`: ≤ 150 characters, plain English a 16-year-old understands, says WHY it's a valid answer / the key fact to remember.
  Use the teacher's own wording/mnemonics/examples from the source files where available.
- Every answer must be CORRECT for the IB syllabus and match what the class was actually taught (source files). If unsure, leave it out.
- Prefer prompts that test exam-relevant knowledge (definitions, examples, case-study facts, diagram labels, named examples
  the IB guide requires, key dates, command terms, formulas' parts).
- Prompt ids: "<subject>-01", "<subject>-02", ... unique.

## Cards — 40–80 per subject
Front = term/question (short), back = definition/answer (≤ 220 chars). Reuse the existing flashcard TSV for the subject
(fix anything wrong), and ADD cards for the most recent units that the TSV doesn't cover.

## Quiz — 25–40 multiple-choice per subject
4 choices, exactly one correct, `answer` = index 0–3 (vary the position!), plausible wrong options (common misconceptions),
`explain` ≤ 200 chars. Include calculation questions where the subject has them (Math, Econ, Bio Simpson's index etc.).

## Coverage
- Cover EVERY unit taught this school year so far (Aug → late Nov 2026), weighted ~50% toward the current unit and whatever
  is on the next exam (Semester 1 finals are mid-December 2026).
- Units list: 3–8 units, ids short ("u1", "a4", "myanmar"...), names short (≤ 40 chars).

## Hard rules
- NO personal data at all: no grades, absences, student or classmate names, teacher names, emails, school name, dates of his
  personal deadlines. The site will be public. Teacher mnemonics/wording are fine without attribution.
- Do not copy long passages of copyrighted text (novel quotes ≤ 10 words, and only a few).
- Write the file, then validate it: `python3 -c "import json;d=json.load(open('PATH'));print(len(d['prompts']),len(d['cards']),len(d['quiz']))"`
  and also check that every quiz `answer` is 0–3, every tier is 1–5, every prompt has ≥6 answers, and no alias is shared
  within a prompt. Fix and re-validate until clean.
- Final reply to me: just the counts, the unit list, and anything in the sources that looked out of date or uncertain (≤ 120 words).
