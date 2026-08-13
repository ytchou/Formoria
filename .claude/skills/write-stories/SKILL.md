---
name: write-stories
description: Draft a long-form zh-TW Formoria story (brand guide, event guide, category guide) from a topic brief, in the Formoria 小編 house voice. Use whenever the user asks for a new article, story, 專題, or 導覽 for formoria.com, or wants an existing draft rewritten into the house voice. Produces an MDX file under content/stories/ with every fact traceable to a source. NOT for social posts, brand descriptions, or English content.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# Drafting a Formoria story

Produces a first draft that is roughly 80% finished. The last 20% — final
judgment calls, the sharpest lines, anything requiring taste — stays human. Do
not present output as publication-ready.

## The one rule that governs the rest

**事實正確 → 資訊完整 → 沒有 AI 痕跡 → 有人味。人味永遠排最後。**

When voice and accuracy conflict, accuracy wins without discussion.

---

## Step 1 — Read the voice pack

Before anything else, read:

- `voice/persona.md` — who 小編 is, rhythm, 語氣天花板, self-promotion discipline
- `voice/kill-list.md` — what must not appear
- `voice/exemplars/` — passages from published stories, if present

Do not skim these. They are the specification.

## Step 2 — Gather facts before writing a word

The draft may assert **only** what appears in a fact sheet. Everything else
becomes a `[待確認]` marker for the human editor. A wrong booth number or an
invented founder detail is a credibility problem, and unsupported quality or
efficacy claims carry real 公平交易法 exposure.

Generate the sheet:

```bash
pnpm exec tsx --env-file=.env.local scripts/story-facts.ts \
  --event <event-slug> --out /tmp/story-facts.json
```

or `--brands slug,slug,slug` when the article is not tied to an event. The sheet
pulls from `content/events/*.json` (checked in, versioned, reviewed) and from the
brands / `brand_faq` / `brand_channels` tables, tagging every field with its
origin.

Read the sheet. Note its `missing` arrays, `unresolvedSlugs`, and `warnings` —
those are the gaps, and they are where `[待確認]` markers go. A warning means a
source was unavailable, not that its facts are known to be empty.

**If the brief needs facts the sheet cannot supply** (an external award, a
founder interview, a press mention), dispatch a research subagent for those
specific facts and require a source URL per fact. Facts returned without a
source do not enter the draft. Never run `runEnrich` or the reputation-research
services to fill a gap — they mutate brand rows and require a real curation job.

## Step 3 — Outline against the brief

The human's brief owns the angle, the selection, and what the article is for.
Do not substitute your own thesis. Produce a section list and confirm it before
drafting prose if the brief leaves the structure open.

`persona.md` §8 has the shape that worked for a brand guide. It is a starting
point, not a template — a different brief gets a different structure.

## Step 4 — Draft, section by section

**Before writing the prose for each section, state two specific voice patterns
from `voice/persona.md` that will govern that section.** Name them explicitly,
then write. This is not ceremony — a voice file that is merely "read" stops
binding after the second section, and naming the patterns per section is what
keeps it live.

While drafting:

- Paragraphs 100–160 字, flowing. **Short sentences, not short paragraphs** —
  chopping prose into fragments reads more machine-like, not less.
- Every brand gets one concrete sensory or material detail.
- Every judgment gets its reason.
- Fact blocks (攤位、日期、票務、驗證、揭露) go flat: no 語氣詞, no exclamation
  marks, no parenthetical asides.
- No Formoria mention in the first 200 字. Maximum three in the article, one at
  the close.
- Headings may use an editorial gloss (個人風格); link text uses the canonical
  taxonomy label (服飾鞋履).

## Step 5 — Emit MDX

Write to `content/stories/<slug>.mdx`. Frontmatter:

```yaml
---
title: ""
description: ""
slug: <kebab-case, must match the filename stem>
locale: zh-TW
publishedAt: YYYY-MM-DD
draft: true
tags: [] # must be from src/lib/taxonomy/story-tags.ts — a bad tag fails CI
voiceCanonical: false # a human sets this to true once the voice is approved
---
```

Available components — **only these** (`src/lib/mdx/components.ts`):

| Component        | Props                                     |
| ---------------- | ----------------------------------------- |
| `<BrandCard>`    | `slug` required; `note`, `eyebrow`        |
| `<BrandRow>`     | children only — nested `<BrandCard>`      |
| `<BrandList>`    | children only — nested `<BrandLine>`      |
| `<BrandLine>`    | `slug` required; `booth`, `note`          |
| `<BrandGrid>`    | `slugs={[...]}` required; `notes={{...}}` |
| `<Figure>`       | `src`, `alt` required; `caption`          |
| `<PullQuote>`    | children; `attribution`                   |
| `<StatsCallout>` | `stat`, `label` required                  |
| `<Disclaimer>`   | children                                  |
| `<FaqBlock>`     | `questions={[{q, a}]}`                    |

Use string-literal props everywhere except `BrandGrid slugs`/`notes` and
`FaqBlock questions`, which take expressions.

**Brand links.** A prose link `[名字](/brands/<slug>)` must use a slug that
actually exists — verify each against the fact sheet. A dead prose link is a
plain `<a>` that 404s in production; unlike the shortcodes it has no runtime
fallback. The CI guard now checks these, so a typo fails the build rather than
shipping.

## Step 6 — Lint, then hand over

```bash
python3 scripts/story-lint/check.py content/stories/<slug>.mdx
pnpm exec vitest run src/lib/services/__tests__/story-content-slugs.test.ts \
  src/lib/taxonomy/__tests__/story-tags.test.ts
```

The linter flags; it does not rewrite. Fix real violations. If a flag is a false
positive, say so rather than contorting the prose around it — and consider
whether the rule needs adjusting in `voice/kill-list.md`.

Hand over with:

- Where the draft is
- Every `[待確認]` marker and what it needs
- Any linter flag deliberately left in place, with the reason
- Which sections you are least confident about

Do not claim the draft is ready to publish.
