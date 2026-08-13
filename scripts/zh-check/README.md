# zh-check — 支語 and orthography gate

Scans zh-TW content for Mainland-Chinese wording and simplified characters. Run
by `/write-stories` before it hands over a draft, and safe to run in CI.

```bash
pnpm zh:check content/stories/<slug>.mdx            # vocabulary + orthography
pnpm zh:check content/stories/<slug>.mdx --patterns # also flag structural AI tells (warn-only)
python3 scripts/zh-check/selftest.py                # fixtures + dictionary parse
```

Exit codes: `0` clean (warnings allowed), `1` HARD-BAN terms or simplified
characters, `2` usage or dictionary error.

## What it is not

`zh-check` and `scripts/story-lint/` are complementary, not alternatives, and
neither subsumes the other:

| | Catches | Misses |
|---|---|---|
| `zh-check` | 支語 vocabulary (a ~200-row severity-tagged dictionary), simplified characters, a handful of structural AI tells | House voice, MDX structure, anything quote- or shortcode-aware |
| `story-lint` | AI writing tells, Formoria house voice, paragraph and sentence rhythm, MDX-aware and quote-aware | Vocabulary breadth — its 支語 layer is a half-dozen rows |

Run both. `story-lint` is the one that understands MDX; `zh-check` is the one
with the dictionary.

## Provenance

Vendored from `~/.claude/skills/shared/zh-tw/`, which is the upstream copy.
Vendored rather than referenced so the gate runs on a CI runner and on any
machine without that config repo checked out.

This directory was vendored once before and deleted from the tree by
`54610784` ("land six accumulated main changesets"), together with its
`.gitignore` allowlist line — collateral loss during a consolidation, not a
decision. If it disappears again, check whether a bulk changeset dropped it
before assuming it was removed on purpose.

Re-sync from upstream:

```bash
for f in check.py selftest.py forbidden-terms.md style.md social-voice.md test_clean.md test_dirty.md; do
  cp ~/.claude/skills/shared/zh-tw/$f scripts/zh-check/$f
done
python3 scripts/zh-check/selftest.py
```

Edits belong upstream first, then re-sync — a fix made only here is lost on the
next sync, and the two copies drifting apart is worse than either being stale.

## Files

| File | Role |
|---|---|
| `check.py` | The scanner. Parses `forbidden-terms.md` as its rule table |
| `forbidden-terms.md` | The dictionary — markdown tables, severity `HARD-BAN` / `PREFER-TW` / `CONTEXT` / `SOCIAL-ONLY` / `ALLOW` |
| `selftest.py` | Fixtures, dictionary-parse assertion, false-positive guards |
| `style.md` | 歐化中文 fixes, punctuation standard, 盤古之白 spacing — prose reference, not executed |
| `social-voice.md` | Short-form register — prose reference, not executed |
| `test_clean.md`, `test_dirty.md` | `selftest.py` fixtures. `test_dirty.md` must exit 1, `test_clean.md` must exit 0 |
