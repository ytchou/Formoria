---
name: formoria-voice-refresh
description: Re-derive the Formoria story voice pack from the published corpus in content/stories/. Use after publishing a new story, after editing the voice rules, or when drafts start drifting from the house voice. Regenerates exemplars and prints a per-story drift report. NOT for drafting — that is write-stories.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# Refreshing the voice pack

`content/stories/*.mdx` is the source of truth for the Formoria house voice.
This skill re-derives the parts of the voice pack that are supposed to track the
corpus, and reports where the corpus itself is drifting.

**Hand-authored, never touched by this skill:**
`.claude/skills/write-stories/voice/persona.md` and `voice/kill-list.md`. Those
encode editorial decisions. If they need to change, a human changes them.

**Derived, rewritten by this skill:**
`voice/corpus.md` and `voice/exemplars/`.

---

## Step 1 — Read the corpus

Read every `content/stories/*.mdx`. For each, note its frontmatter
`voiceCanonical` flag.

- `voiceCanonical: true` — eligible to be quoted as an exemplar
- absent or `false` — read for the drift report, never quoted

The flag exists because a corpus that treats every story as exemplary regresses
toward its own drift. One article that slips into 您 teaches the next one to do
the same. A human sets the flag after reading the piece; this skill never sets
it.

## Step 2 — Select exemplars (this is the part that is easy to get wrong)

Write **about five** passages to `voice/exemplars/`, drawn only from canonical
stories. Two rules, both counter-intuitive, both measured:

**Five is the plateau.** Style imitation improves sharply from zero exemplars to
a handful and then flattens — going from 5 to 10 adds almost nothing while
consuming context. Do not accumulate every story into the folder.

**Select for stylistic range, never for topical similarity.** Choosing passages
because they resemble the upcoming article's subject measurably *reduces* voice
fidelity: topical clustering narrows the stylistic variety the model sees. Pick
passages that differ from each other in register and function:

1. An opening — how a piece establishes the reader's problem
2. A brand paragraph — judgment plus concrete sensory detail
3. A flat fact block — 攤位／日期／免責, showing where the voice goes cold
4. A closing — self-mention discipline and the parting question
5. A single judgment sentence — the 小編 voice at its most opinionated

Each exemplar file: the passage, its source story, and one line on what it
demonstrates. Nothing else — commentary dilutes the signal.

## Step 3 — Write the drift report to `voice/corpus.md`

Run the linter across the whole corpus:

```bash
python3 scripts/story-lint/check.py content/stories/*.mdx
```

Then write `voice/corpus.md` containing, per story: title, `voiceCanonical`
status, CJK length, and the linter's findings by rule. Add a corpus-level
summary of what the voice actually does across all stories — recurring
structures, how brands get introduced, how fact blocks are set off.

Flag divergence between the *rules* and the *corpus* explicitly. If several
published stories break a rule in `kill-list.md`, that is worth saying out loud:
either the corpus is drifting or the rule is wrong, and only a human can decide
which.

## Step 4 — Report

Summarise for the user:

- Stories read, and how many were canonical
- Which passages were selected as exemplars and why each was chosen
- Drift findings, worst first
- Any rule you believe is over-firing or should change

Do not edit `persona.md` or `kill-list.md` yourself. Propose, and let the user
decide.
