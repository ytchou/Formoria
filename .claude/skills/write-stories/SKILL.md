---
name: write-stories
description: Use when drafting or rewriting a long-form zh-TW article for formoria.com — a 專題, 導覽, 主題選物, discovery trail, L1 category guide, brand guide, or event guide — or when the user says "write a story", "draft an article", or names a reader situation to build a selection around. Produces an MDX file under content/stories/ with every fact traceable to a source. NOT for social posts, brand descriptions, marketing copy, or English content.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# Drafting a Formoria story

Produces a draft that is roughly 80% finished. The last 20% — final judgment
calls, the sharpest lines, anything requiring taste — stays human. Do not present
output as publication-ready.

## The one rule that governs the rest

**事實正確 → 資訊完整 → 沒有 AI 痕跡 → 有人味。人味永遠排最後。**

When voice and accuracy conflict, accuracy wins without discussion.

## Autonomy

Run start to finish without stopping for approval. The safety net is
`draft: true` plus the linters, not a mid-run question — a pause that waits on a
human who is not watching produces neither a draft nor a decision.

Two things override this: if the requested slate cannot be sourced at all, stop
and report rather than inventing one; and if the story would need a claim this
skill forbids, say so instead of softening it into something publishable.

---

## Step 1 — Resolve the config

Two shapes, and picking the wrong one costs a rewrite rather than an edit.

| The organising idea is… | Config | Signal |
|---|---|---|
| A **kind of thing** — material, craft, L1 category | `configs/l1-category.md` | Title names a category. Reader knows what they are looking at |
| A **reader's situation** | `configs/discovery-trail.md` | Title starts 「在…的時候」 or quotes the reader. Reader has no keyword |

Take the mode from the argument when given. Otherwise infer it and **state the
inference in your hand-off** — a misfiled story reads as competent and argues
nothing, which is hard to spot later.

## Step 2 — Read the spec

Before drafting a word:

- `voice/persona.md` — who 小編 is, rhythm, 語氣天花板, self-promotion discipline
- `voice/kill-list.md` — what must not appear
- `voice/brand-rules.md` — what Formoria may claim
- `references/mdx-contract.md` — frontmatter, tags, shortcodes
- the config resolved in step 1
- `voice/exemplars/` — passages from published stories, if present

Do not skim these. They are the specification.

`persona.md` and `brand-rules.md` are different ceilings: one governs how a
sentence sounds, the other what it may assert. A draft can pass one and fail the
other.

## Step 3 — Gather facts before writing a word

The draft may assert **only** what appears in a fact sheet. Everything else
becomes a `[待確認]` marker for the human editor. A wrong booth number or an
invented founder detail is a credibility problem, and unsupported quality or
efficacy claims carry real 公平交易法 exposure.

```bash
pnpm story:facts --event <event-slug> --out /tmp/story-facts.json
pnpm story:facts --brands slug,slug,slug --out /tmp/story-facts.json
```

`--event` and `--brands` union rather than intersect. The sheet pulls from
`content/events/*.json` (checked in, versioned, reviewed) and from the brands,
`brand_faq_entries`, and `brand_channels` tables, tagging every field with its
origin.

Read the sheet. Its `missing` arrays, `unresolvedSlugs`, and `warnings` are where
`[待確認]` markers go. A warning means a source was unavailable, not that its
facts are known to be empty.

**FAQ entries carry a `source`.** `human` is a brand owner's or admin's own words
and may be quoted as such. `model` is generated text — treat it as a lead to
verify, never as something the brand said.

**If the brief needs facts the sheet cannot supply** (an award, an interview, a
press mention), research those specific facts and require a source URL per fact.
Facts returned without a source do not enter the draft. Never run `runEnrich` or
the reputation-research services to fill a gap — they mutate brand rows and
require a real curation job.

**If the sheet comes back mostly empty**, say so in the hand-off and give the
count. A draft that is 80% `[待確認]` is a structural skeleton, not a draft, and
reporting it as one wastes the editor's time.

## Step 4 — Outline against the brief

The human's brief owns the angle, the selection, and what the article is for. Do
not substitute your own thesis. Build the section list from the config's shape,
then check it against the config's own trap — the L1 category roster problem, or
the trail's cross-category test — before writing prose.

Record the outline and the slate in your hand-off. It is not an approval gate; it
is what makes a wrong turn diagnosable.

## Step 5 — Draft, section by section

**Before writing the prose for each section, state two specific voice patterns
from `voice/persona.md` that will govern that section.** Name them explicitly,
then write. This is not ceremony — a voice file that is merely "read" stops
binding after the second section, and naming the patterns per section is what
keeps it live.

While drafting:

- Paragraphs 100–160 字, flowing. **Short sentences, not short paragraphs** —
  chopping prose into fragments reads more machine-like, not less.
- Every brand gets one concrete sensory or material detail, or a `[待確認]`
  marker where the fact sheet is silent. Never an adjective standing in for one.
- Every judgment gets its reason.
- Every selection carries the five beats from `voice/brand-rules.md` §3.
- Fact blocks (攤位、日期、票務、驗證、揭露) go flat: no 語氣詞, no exclamation
  marks, no parenthetical asides.
- No Formoria mention in the first 200 字. Maximum three in the article, one at
  the close.

## Step 6 — Emit MDX

Write to `content/stories/<YYYY-MM-DD>-<name>.mdx`, where the date prefix is the
publish date. The full frontmatter and shortcode contract is
`references/mdx-contract.md`. The parts most often got wrong:

- `slug` must equal the **entire filename stem**, date prefix included. The route
  resolves against the filename while the canonical, the sitemap, and the JSON-LD
  are built from `slug` — both published stories shipped with the date stripped
  out and pointed every indexing signal at a 404.
- `faq` goes in **frontmatter**, 4–6 entries. An in-body `<FaqBlock>` renders the
  same accordion and emits no JSON-LD.
- `draft: true` and `voiceCanonical: false`. A human flips both.
- `tags` come from the closed vocabulary. An invented tag fails CI.
- `heroImage` points at `/images/stories/<slug>.webp`. This skill does not
  generate the image — report the missing file as a hand-off item.
- Plain string props everywhere except `BrandGrid`'s `slugs`/`notes`.

Every `/brands/<slug>` reference, prose link or shortcode, must name a brand that
exists in the fact sheet. A prose link has no runtime fallback — a typo is a 404.

## Step 7 — Gates

All of these run before hand-off. A draft that has not passed them is not done.

```bash
pnpm story:lint content/stories/<file>.mdx
pnpm zh:check content/stories/<file>.mdx --patterns
node scripts/checks/story-frontmatter.mjs
pnpm exec vitest run src/lib/taxonomy/__tests__/story-tags.test.ts \
  src/lib/services/__tests__/story-content-slugs.test.ts
```

The two linters are complementary: `story:lint` catches AI tells and house voice
and understands MDX; `zh:check` carries the 支語 dictionary and simplified
characters. Neither subsumes the other.

**The linters flag; they do not authorise a silent rewrite.** Fix real
violations. If a flag is a false positive, say so rather than contorting the
prose around it — and consider whether the rule needs adjusting in
`voice/kill-list.md`. A model rewriting its own prose toward a checklist
reproduces its own blind spots and flattens the result.

Then the two checks no linter can make:

**The `brand-rules.md` §7 pre-hand-off list.** Work through it. The claim ceiling
is not mechanically checkable in full.

**Self-score, 1–10 each:** 直接性 (does it get to the point), 節奏 (do sentence
lengths vary), 信任度 (does it over-explain), 真實性 (does it sound like a
specific person), 精煉度 (is there anything left to cut). **Below 35/50, rewrite
before handing over.** This is the only guard on rhythm — no linter catches
prose that passes every rule and still reads translated.

## Step 8 — Hand over

- Where the draft is, and which config produced it (say if the mode was inferred)
- The slate, with each brand's source URL
- Every `[待確認]` marker and what it needs
- Gate results, and any flag deliberately left in place with the reason
- The self-score, per dimension
- Missing hero image, if any
- Which sections you are least confident about

Do not claim the draft is ready to publish.

---

## Anti-patterns

- **Don't invent a fact to avoid a `[待確認]` marker.** The marker is the correct
  output. An adjective covering for a missing measurement is worse than a gap,
  because it looks finished.
- **Don't invent an experience.** 「我把 552 個攤位走完了」 is a fabrication when
  the list came from a roster. 小編 has a personality, not a biography.
- **Don't write 選物 for a brand that was merely 收錄**, and don't dodge both
  words to avoid deciding — see `brand-rules.md` §2.
- **Don't let a trail's slate sit in one category.** More than half from one
  category means it is a category page.
- **Don't put the FAQ in the body** and lose the FAQPage JSON-LD.
- **Don't rewrite published stories to satisfy the linter.** Stories predating
  these rules carry `voiceCanonical: false` on purpose; the drift report is
  supposed to show them.
- **Don't stop mid-run to ask for approval.** `draft: true` is the gate.
