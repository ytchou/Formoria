#!/usr/bin/env python3
"""
zh-TW long-form prose linter for story MDX.

Flags the structural tells that make Traditional-Chinese prose read as
machine-written to a Taiwanese reader. It REPORTS ONLY and never rewrites:
optimizing prose against a rubric measurably degrades it, so the decision
stays with a human editor.

Companion to scripts/check-zh-terms.ts, which handles vocabulary (Mainland
wording) across messages, MDX content, and public category labels. This file
handles shape: sentence rhythm, paragraph size, contrast constructions,
register.

Usage:
  python3 scripts/story-lint/check.py <path.mdx> [<path.mdx> ...]
  python3 scripts/story-lint/check.py --selftest
  --json     machine-readable output
  --strict   treat WARN as failure too

Exit codes:
  0 = clean (warnings allowed unless --strict)
  1 = errors found (or warnings under --strict, or a failing selftest)
  2 = usage / fixture error

--------------------------------------------------------------------------
Golden fixture format (golden/should-fix.md, golden/must-not-break.md)
--------------------------------------------------------------------------
Each case is a level-2 heading, a key: value block, then the input inside a
FOUR-backtick fence (four, so a case can itself contain a normal ``` block):

    ## case: honorific-nin-basic
    expect: honorific-nin
    note: free-text, ignored by the parser

    ````
    邀請您一同前往展區探索。
    ````

Keys:
  expect  required. A rule id, or `none` for a must-not-break case.
  ignore  optional, comma-separated rule ids tolerated on a `none` case.
          Only for document-shape rules a fixture is too small to satisfy
          (a 30-char fixture is not a real paragraph).
  note    optional free text.

--selftest asserts: every `expect: <rule>` case reports that rule, and every
`expect: none` case reports nothing outside its `ignore` list.
"""

import argparse
import json
import re
import sys
from pathlib import Path

GOLDEN_DIR = Path(__file__).parent / "golden"

CJK = r"㐀-䶿一-鿿豈-﫿"
CJK_RE = re.compile(f"[{CJK}]")

# Sentence terminators, full-width and half-width. Chinese prose also ends
# clauses on ；, which is close enough to a sentence break for rhythm rules.
SENTENCE_END = "。！？!?；;…"

# Paragraph lines that are not prose: headings, list items, blockquotes,
# tables, thematic breaks, and leftover shortcode-only lines.
NON_PROSE_LINE = re.compile(r"^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||-{3,}|:{3})")

RULE_SEVERITY = {
    "forbidden-claim": "ERROR",
    "em-dash-density": "ERROR",
    "not-a-but-b": "ERROR",
    "honorific-nin": "ERROR",
    "plural-men": "ERROR",
    "nominalization": "ERROR",
    "formulaic-closing": "ERROR",
    "formoria-early": "ERROR",
    "three-part-parallel": "WARN",
    "stance-vacuum": "WARN",
    "formulaic-opening": "WARN",
    "false-confession": "WARN",
    "de-density": "WARN",
    "sentence-monotony": "WARN",
    "paragraph-length": "WARN",
    "exclamation": "WARN",
    "formoria-count": "WARN",
}


# --------------------------------------------------------------------------
# Stripping. Every strip blanks characters in place (spaces, newlines kept),
# so line numbers and character offsets survive into the findings.
# --------------------------------------------------------------------------


def _blank(match):
    """Replace a span with spaces, preserving its newlines and total length."""
    return re.sub(r"[^\n]", " ", match.group(0))


FENCE_LINE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def strip_fenced_code(text: str) -> str:
    """
    Blank fenced code blocks, line by line rather than with a backreference
    regex: fences nest by type, so a ~~~ block may legally contain ``` lines
    (same edge cases as src/lib/mdx/extract-brand-slugs.ts). A fence left
    unclosed at EOF swallows the rest of the file, which is the safe
    direction — malformed content should under-report, not invent findings.
    """
    out = []
    open_fence = None
    for line in text.split("\n"):
        m = FENCE_LINE.match(line)
        fence = m.group(1) if m else None
        if open_fence is None:
            if fence:
                open_fence = fence[0]
                out.append(" " * len(line))
                continue
            out.append(line)
        else:
            out.append(" " * len(line))
            if fence and fence[0] == open_fence:
                open_fence = None
    return "\n".join(out)


def strip_frontmatter(text: str) -> str:
    """Blank leading YAML frontmatter. Only a --- on line 1 opens one."""
    if not text.startswith("---"):
        return text
    m = re.match(r"^---[^\n]*\n.*?\n---[^\n]*(?=\n|$)", text, flags=re.S)
    return _blank(m) + text[m.end() :] if m else text


# `<Figure src="…" />`, `<BrandRow>`, `</BrandRow>`. Attribute values are
# matched as quoted strings or {…} expressions rather than "anything up to >":
# a prop value may legally contain a > (note="a > b"), and a >-excluding
# prefix makes the tag fail to match, leaking `src="…"` into the prose. Only
# the TAG is blanked — text between an opening and closing tag is prose and
# must still be linted.
MDX_TAG = re.compile(
    r"</?[A-Za-z][\w.:-]*"
    r"(?:\s+[\w:.-]+(?:=(?:\"[^\"]*\"|'[^']*'|\{[^{}]*\}))?)*"
    r"\s*/?>"
)

# [link text](/brands/slug) — keep the text, blank the brackets and target,
# so 織療室 counts as prose and the slug never does. Images (![alt](src))
# have no prose to keep, so the whole thing goes.
MD_LINK = re.compile(r"(!?)\[([^\]\n]*)\]\(([^)\n]*)\)")

# A line that is nothing but a link (plus a trailing arrow) is navigation —
# 「瀏覽本站全部工藝文創品牌 →」. Counting it as a paragraph would fire
# paragraph-length on every category CTA in every article, which is exactly
# how a linter earns its way into someone's ignore list.
NAV_ONLY_LINE = re.compile(
    r"^[ \t]*!?\[[^\]\n]*\]\([^)\n]*\)[ \t]*[→↗›»…]*[ \t]*$", re.M
)


def _strip_link(match):
    keep = "" if match.group(1) else match.group(2)
    return " " * (match.start(2) - match.start(0)) + keep + " " * (
        match.end(0) - match.end(2)
    )


def strip_non_prose(text: str) -> str:
    """Blank everything that is markup rather than authored prose."""
    text = strip_frontmatter(text)
    text = strip_fenced_code(text)
    text = re.sub(r"`[^`\n]*`", _blank, text)
    text = re.sub(r"<!--.*?(-->|\Z)", _blank, text, flags=re.S)
    text = re.sub(r"\{\s*/\*.*?\*/\s*\}", _blank, text, flags=re.S)
    text = MDX_TAG.sub(_blank, text)
    text = NAV_ONLY_LINE.sub(_blank, text)
    text = MD_LINK.sub(_strip_link, text)
    text = re.sub(r"<?https?://[^\s)>\]]+>?", _blank, text)
    return text


# Quotation spans. Quoted material is the author's SOURCE, not the author's
# prose: a customer-service 「您好」 example, or a sentence discussing the
# 『不是A而是B』 pattern rather than using it, must not be flagged. 《》〈〉
# additionally carry work/platform titles, which is how a proper noun that
# contains a banned substring stays legal.
QUOTE_SPANS = [
    re.compile(r"「[^「」]*」"),
    re.compile(r"『[^『』]*』"),
    re.compile(r"《[^《》]*》"),
    re.compile(r"〈[^〈〉]*〉"),
    re.compile(r"“[^“”]*”"),
]


def quoted_ranges(text: str):
    """(start, end) spans whose contents are quoted, innermost first."""
    spans = []
    for pattern in QUOTE_SPANS:
        for m in pattern.finditer(text):
            spans.append((m.start(), m.end()))
    return spans


def in_quote(pos: int, spans) -> bool:
    return any(start <= pos < end for start, end in spans)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def cjk_len(text: str) -> int:
    """CJK characters only — ASCII, whitespace and punctuation do not count."""
    return len(CJK_RE.findall(text))


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def tidy(text: str) -> str:
    """Collapse the whitespace left behind by stripping, for readable output."""
    return re.sub(r"\s+", " ", text).strip()


def snippet(text: str, pos: int, width: int = 24) -> str:
    """A one-line excerpt around an offset, for the report."""
    start = max(0, pos - width // 2)
    end = min(len(text), pos + width)
    return tidy(text[start:end])


def heading_lines(text: str):
    """1-based line numbers of markdown headings — never body prose."""
    return {
        i
        for i, line in enumerate(text.split("\n"), start=1)
        if re.match(r"^\s*#{1,6}\s", line)
    }


def paragraphs(text: str):
    """
    (start_offset, block_text) for each prose paragraph. Blocks separated by
    blank lines; heading/list/table/quote lines are dropped, and a block with
    no CJK left is not a paragraph at all.
    """
    raw_blocks = []
    pos = 0
    # finditer rather than re.split: the separator run is not a fixed width
    # (a blanked shortcode leaves a line of spaces behind), and guessing its
    # length walks every finding in the block onto the wrong line.
    for m in re.finditer(r"\n[ \t]*\n", text):
        raw_blocks.append((pos, text[pos : m.start()]))
        pos = m.end()
    raw_blocks.append((pos, text[pos:]))

    blocks = []
    for offset, raw in raw_blocks:
        # Blank, do not delete: dropping a heading line would shift every
        # offset after it inside the same block.
        kept = "\n".join(
            " " * len(line) if NON_PROSE_LINE.match(line) else line
            for line in raw.split("\n")
        )
        if cjk_len(kept):
            blocks.append((offset, kept))
    return blocks


def sentences(block: str, base: int):
    """(offset, sentence_text) within a paragraph, terminators included."""
    out = []
    start = 0
    for i, ch in enumerate(block):
        if ch in SENTENCE_END:
            # Absorb a run of terminators (「……。」, 「?!」) into one sentence.
            if i + 1 < len(block) and block[i + 1] in SENTENCE_END:
                continue
            piece = block[start : i + 1]
            if cjk_len(piece):
                out.append((base + start, piece))
            start = i + 1
    tail = block[start:]
    if cjk_len(tail):
        out.append((base + start, tail))
    return out


# --------------------------------------------------------------------------
# Rules. Each appends (offset, rule_id, text, reason_zh_tw).
# --------------------------------------------------------------------------

# Half-width — and the full-width pair ——. NOT the en dash – (U+2013): a
# numeric range like 1939–1945 is typography, not a connector. A run of
# dashes counts as one occurrence.
EM_DASH_RUN = re.compile(r"—+")

NOT_A_BUT_B = [
    # 不是A，而是B — the comma is optional in tight constructions.
    re.compile(r"不是[^。！？\n]{1,40}?，?而是"),
    re.compile(r"不[只單][是了]?[^。！？\n]{1,40}?，?而是"),
    re.compile(r"不僅[^。！？\n]{1,40}?，?更"),
]

# 們 on anything that is not a pronoun. 人們 is idiomatic and stays.
MEN_ALLOWED = {
    "我們",
    "你們",
    "妳們",
    "您們",
    "他們",
    "她們",
    "它們",
    "牠們",
    "祂們",
    "咱們",
    "人們",
}
MEN_RE = re.compile(f"[{CJK}]們")

# 進行X / 作出X — a nominalized verb where the plain verb reads better.
NOMINALIZATION = re.compile(f"(進行|作出|做出|實現|予以|加以|給予|進而實施)[{CJK}]{{1,4}}")

FORMULAIC_CLOSINGS = [
    "總的來說",
    "綜上所述",
    "在未來的道路上",
    "值得一提的是",
    "讓我們拭目以待",
    "未來可期",
]

# 讀懂、拆解、生成， — EXACTLY three 2-4 char phrases in a row, terminated by
# something other than another 、. Separators are 、 only (not ，): a 、-joined
# run of short phrases is the rule-of-three tell, while ，-joined clauses are
# ordinary sentences.
#
# "Exactly three" is the whole rule, and the trailing class excludes 、 to
# enforce it. An earlier `{2,}` version flagged every four-or-more item list and
# produced nothing but false positives on this corpus — 「貼紙、別針、鑰匙圈、杯墊」
# is a catalogue of concrete nouns, which is what a brand directory writes all
# day. The AI habit being caught here is the rhetorical triad, so a run that
# keeps going past three is evidence AGAINST the tell, not for it.
#
# The leading `(?<!、)` closes the other half of the same hole: without it the
# pattern happily matches the last three items of a four-item list
# (貼紙、[別針、鑰匙圈、杯墊]), reintroducing the false positive the exact-three
# rule was meant to remove. A 、 immediately before the match means the run
# started earlier, so this is a catalogue, not a triad.
THREE_PART = re.compile(f"(?<!、)(?:[{CJK}]{{2,4}}、){{2}}[{CJK}]{{2,4}}[，。！？]")

# 立場真空 — the paragraph declined to have an opinion. These read as balance
# but carry no judgment, and a selection piece whose whole job is to say why
# something was chosen cannot afford them. The fix is the author's actual choice
# and its reason; where the author never gave one, a 待確認 marker is correct and
# inventing a stance is not.
STANCE_VACUUM = [
    "各有優缺點",
    "各有千秋",
    "因人而異",
    "見仁見智",
    "取決於多方面因素",
    "沒有標準答案",
    "適合自己的最好",
]

# 公式化開場 — the era-hat. The first sentence should carry information only
# this article has; a trend preamble is what a model writes when it has not
# decided what the piece is about yet.
FORMULAIC_OPENINGS = [
    re.compile(r"^在(當今|這個)[^。！？\n]{0,20}的(時代|年代|世界)"),
    re.compile(r"^隨著[^。！？\n]{2,20}的(發展|興起|普及|進步)"),
    re.compile(r"^近年來[，,]"),
    re.compile(r"^在[^。！？\n]{0,12}快速[^。！？\n]{0,8}的今天"),
]

# 假坦白鉤子 — a manufactured confession used as an opener. It performs candour
# rather than reporting anything, and kill-list.md Tier 4 bans the whole family:
# 小編 may have a personality, not a fabricated inner life.
FALSE_CONFESSION = [
    re.compile(r"^(老實說|說實話|坦白說|不瞞你說|我承認)[，,]"),
    re.compile(r"^我(以前|之前|原本)(一直|總是)?(以為|覺得|認為)[^。！？\n]{2,30}[，,](後來|直到)"),
]

# Claims the brand rules forbid outright. This is the one new rule at ERROR:
# the others are habits that read badly, while these are assertions that are
# either untrue or outside what Formoria is allowed to say. See
# .claude/skills/write-stories/voice/brand-rules.md §4.
#
# Superlatives and rankings are matched as words; the commerce and assurance
# families are matched as claim shapes, because 「價格」 alone is a legitimate
# topic (「價格帶請以官方頁面為準」) and only an asserted number is a violation.
FORBIDDEN_CLAIMS = [
    (re.compile(r"最(好|棒|優|讚)(的)?(選擇|品牌|產品)?"), "最好類最高級：改成具體比較或刪掉"),
    (re.compile(r"必買|必收|必備款|不買可惜|錯過可惜"), "購買催促語，Formoria 不做購買主張"),
    (re.compile(r"首選|第一品牌|人氣第一|銷量第一|全台第一|台灣第一"), "無方法論的排名主張"),
    (re.compile(r"立即購買|馬上購買|馬上下單|立即下單|現在不買"), "硬性 CTA：改成「前往品牌官方網站」"),
    (re.compile(r"保證(有貨|供貨|品質|正品|效果|滿意)"), "保證主張：庫存與品質屬於品牌，不屬於 Formoria"),
    (re.compile(r"(絕對|百分之百|100%)(安全|有效|天然|無毒)"), "安全或效果保證"),
    (re.compile(r"(改善|治療|預防|舒緩)(睡眠|失眠|焦慮|疲勞|過敏)"), "健康或療效主張"),
    (re.compile(r"(護眼|不傷眼|保護視力)"), "視力效果主張"),
    (re.compile(r"(所有|每個|任何)人都(適合|適用|需要|會喜歡)"), "普遍適用主張"),
]

SELF_NAME = "Formoria"
SELF_NAME_EARLY_WINDOW = 200
SELF_NAME_MAX = 3

EM_DASH_PER_CJK = 500

# 「的」 is a rate, not a count. A flat "more than two per sentence" threshold
# fired on 19 sentences of the one published article and on several hand-written
# fixtures that read perfectly naturally — a 60-字 sentence carrying three 的 is
# ordinary zh-TW, while three in a 25-字 sentence is the stacked-modifier tell
# the rule is actually after. Allowance scales with sentence length, with a
# floor so short sentences still get a sane budget.
DE_FLOOR = 2
DE_PER_CJK = 15
MONOTONY_RUN = 3
MONOTONY_TOLERANCE = 0.15
MONOTONY_MIN_CJK = 10
PARA_MIN_CJK = 60
PARA_MAX_CJK = 220


def check_lexical(text: str, quotes):
    """Line-level rules. Every match inside a quotation span is skipped."""
    findings = []

    def add(pos, rule, hit, reason):
        if not in_quote(pos, quotes):
            findings.append((pos, rule, hit, reason))

    for m in re.finditer("您", text):
        add(m.start(), "honorific-nin", "您", "Formoria 對讀者一律用「你」，不用敬稱")

    for m in MEN_RE.finditer(text):
        if m.group(0) in MEN_ALLOWED:
            continue
        add(m.start(), "plural-men", m.group(0), "中文名詞本身不分單複數，「們」是翻譯腔")

    for m in NOMINALIZATION.finditer(text):
        add(m.start(), "nominalization", m.group(0), "空殼動詞加名詞，直接用實際動作的動詞")

    for phrase in FORMULAIC_CLOSINGS:
        for m in re.finditer(re.escape(phrase), text):
            add(m.start(), "formulaic-closing", phrase, "公式化收尾語，刪掉後停在最後一個具體句子")

    for m in THREE_PART.finditer(text):
        add(m.start(), "three-part-parallel", m.group(0).strip(), "三段式排比是 AI 慣性，留一項或改寫成句子")

    for phrase in STANCE_VACUUM:
        for m in re.finditer(re.escape(phrase), text):
            add(m.start(), "stance-vacuum", phrase, "這段沒有做出判斷；寫出實際的選擇與理由，作者沒給就標 [待確認]")

    for pattern, reason in FORBIDDEN_CLAIMS:
        for m in pattern.finditer(text):
            add(m.start(), "forbidden-claim", m.group(0), reason)

    return findings


def check_openings(text: str, quotes):
    """
    Opening-line rules. Both families are about the FIRST sentence of a
    paragraph, so they run per paragraph rather than per line — a 時代大帽子 in
    the middle of a paragraph is a transition, and only the opener is the tell.
    """
    findings = []
    for base, block in paragraphs(text):
        stripped = block.lstrip()
        offset = base + (len(block) - len(stripped))
        if in_quote(offset, quotes):
            continue

        for pattern in FORMULAIC_OPENINGS:
            m = pattern.search(stripped)
            if m:
                findings.append(
                    (
                        offset,
                        "formulaic-opening",
                        m.group(0),
                        "時代大帽子開場：第一句就該有只有這篇文章才有的資訊",
                    )
                )
                break

        for pattern in FALSE_CONFESSION:
            m = pattern.search(stripped)
            if m:
                findings.append(
                    (
                        offset,
                        "false-confession",
                        m.group(0),
                        "假坦白鉤子：表演坦誠但沒有新資訊，作者沒說過的轉折不能代寫",
                    )
                )
                break

    return findings


def check_em_dash(text: str, quotes):
    """
    Density rule: the allowance scales with article length, floor of one.
    A single —— in a long piece is a stylistic choice; several is a tell.
    """
    hits = []
    for m in EM_DASH_RUN.finditer(text):
        if in_quote(m.start(), quotes):
            continue
        before = text[m.start() - 1] if m.start() else ""
        after = text[m.end()] if m.end() < len(text) else ""
        if before.isdigit() and after.isdigit():
            continue  # numeric range, not a connector
        hits.append(m)

    total = cjk_len(text)
    allowed = max(1, total // EM_DASH_PER_CJK)
    findings = []
    for m in hits[allowed:]:
        findings.append(
            (
                m.start(),
                "em-dash-density",
                m.group(0),
                f"破折號密度過高（{len(hits)} 次 / {total} 字，上限 {allowed}），改用句號斷句",
            )
        )
    return findings


def check_not_a_but_b(text: str, quotes):
    """One contrast construction per article is human. Two is a signature."""
    hits = []
    for pattern in NOT_A_BUT_B:
        for m in pattern.finditer(text):
            if not in_quote(m.start(), quotes):
                hits.append(m)
    hits.sort(key=lambda m: m.start())
    return [
        (m.start(), "not-a-but-b", m.group(0), "「不是A而是B」全篇最多一次，其餘改成直述句")
        for m in hits[1:]
    ]


def check_self_mention(text: str, headings):
    """
    Naming yourself in the opening is the house-organ tell. Counted over body
    prose only — headings and frontmatter are not the reader's first sentence.
    """
    findings = []
    seen_cjk = 0
    total = 0
    pos = 0
    for lineno, line in enumerate(text.split("\n"), start=1):
        if lineno not in headings:
            for m in re.finditer(re.escape(SELF_NAME), line):
                total += 1
                if seen_cjk + cjk_len(line[: m.start()]) < SELF_NAME_EARLY_WINDOW:
                    findings.append(
                        (
                            pos + m.start(),
                            "formoria-early",
                            SELF_NAME,
                            f"開場前 {SELF_NAME_EARLY_WINDOW} 字就自報名號，先講事情再講自己",
                        )
                    )
            seen_cjk += cjk_len(line)
        pos += len(line) + 1
    if total > SELF_NAME_MAX:
        findings.append(
            (0, "formoria-count", SELF_NAME, f"全篇提及 {total} 次，上限 {SELF_NAME_MAX} 次")
        )
    return findings


def check_structure(text: str, quotes, headings):
    """Paragraph size, sentence rhythm, 的 density, exclamation marks."""
    findings = []

    for base, block in paragraphs(text):
        size = cjk_len(block)
        # Report the paragraph at its first real character: the block may open
        # with a blanked heading or shortcode line, which is not where the
        # editor is looking.
        first = CJK_RE.search(block)
        head = base + (first.start() if first else 0)
        if size < PARA_MIN_CJK:
            findings.append(
                (
                    head,
                    "paragraph-length",
                    block.strip().split("\n")[0][:20],
                    f"段落只有 {size} 字（建議 100-160）；短的應該是句子，不是段落，"
                    "切碎成一堆短段落只會更像機器寫的",
                )
            )
        elif size > PARA_MAX_CJK:
            findings.append(
                (
                    head,
                    "paragraph-length",
                    block.strip().split("\n")[0][:20],
                    f"段落 {size} 字過長（建議 100-160），找一個轉折處切開",
                )
            )

        block_sentences = sentences(block, base)

        for offset, sentence in block_sentences:
            de_count = sentence.count("的")
            allowance = max(DE_FLOOR, cjk_len(sentence) // DE_PER_CJK)
            if de_count > allowance:
                findings.append(
                    (
                        offset,
                        "de-density",
                        sentence.strip()[:24],
                        f"單句 {cjk_len(sentence)} 字裡有 {de_count} 個「的」，"
                        f"超過 {allowance} 個就偏密，刪掉可有可無的那幾個",
                    )
                )

        # Uniform sentence length is a strong AI signature. The fix is to
        # break ONE of them, not to shorten all three — hence the message.
        lengths = [(o, cjk_len(s)) for o, s in block_sentences]
        reported = set()
        for i in range(len(lengths) - MONOTONY_RUN + 1):
            window = lengths[i : i + MONOTONY_RUN]
            sizes = [n for _, n in window]
            if min(sizes) < MONOTONY_MIN_CJK:
                continue
            if (max(sizes) - min(sizes)) < MONOTONY_TOLERANCE * max(sizes):
                start = window[0][0]
                if start in reported:
                    continue
                reported.add(start)
                findings.append(
                    (
                        start,
                        "sentence-monotony",
                        f"{sizes}",
                        f"連續 {MONOTONY_RUN} 句長度都是 {min(sizes)}-{max(sizes)} 字，"
                        "把其中一句拆短或併長，不要全部改短",
                    )
                )

    for m in re.finditer(r"[！!]", text):
        if in_quote(m.start(), quotes):
            continue
        if line_of(text, m.start()) in headings:
            continue  # standalone headings may exclaim; body prose may not
        findings.append(
            (m.start(), "exclamation", snippet(text, m.start()), "內文不用驚嘆號，靠事實本身帶語氣")
        )

    return findings


def analyze(raw: str):
    """Run every rule. Returns findings sorted by position."""
    text = strip_non_prose(raw)
    quotes = quoted_ranges(text)
    headings = heading_lines(text)

    findings = []
    findings += check_lexical(text, quotes)
    findings += check_em_dash(text, quotes)
    findings += check_not_a_but_b(text, quotes)
    findings += check_self_mention(text, headings)
    findings += check_openings(text, quotes)
    findings += check_structure(text, quotes, headings)

    result = []
    for pos, rule, hit, reason in sorted(findings, key=lambda f: (f[0], f[1])):
        result.append(
            {
                "line": line_of(text, pos),
                "severity": RULE_SEVERITY[rule],
                "rule": rule,
                "text": tidy(hit),
                "reason": reason,
            }
        )
    return result


# --------------------------------------------------------------------------
# Golden fixtures / selftest
# --------------------------------------------------------------------------

CASE_HEADING = re.compile(r"^##\s*case:\s*(\S+)\s*$")
CASE_KEY = re.compile(r"^(expect|ignore|note):\s*(.*)$")
CASE_FENCE = "````"


def parse_golden(path: Path):
    """Parse a golden file into [{id, expect, ignore, input}]."""
    if not path.exists():
        print(f"fixture not found: {path}", file=sys.stderr)
        sys.exit(2)

    cases = []
    current = None
    body = None
    for line in path.read_text(encoding="utf-8").split("\n"):
        if body is not None:
            if line.startswith(CASE_FENCE):
                current["input"] = "\n".join(body)
                cases.append(current)
                current, body = None, None
            else:
                body.append(line)
            continue
        m = CASE_HEADING.match(line)
        if m:
            current = {"id": m.group(1), "expect": None, "ignore": set(), "input": ""}
            continue
        if current is None:
            continue
        m = CASE_KEY.match(line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            if key == "expect":
                current["expect"] = value
            elif key == "ignore":
                current["ignore"] = {v.strip() for v in value.split(",") if v.strip()}
            continue
        if line.startswith(CASE_FENCE):
            body = []

    if not cases:
        print(f"fixture parse error: no cases found in {path}", file=sys.stderr)
        sys.exit(2)
    for case in cases:
        if case["expect"] is None:
            print(f"fixture error: case {case['id']} has no expect:", file=sys.stderr)
            sys.exit(2)
        if case["expect"] != "none" and case["expect"] not in RULE_SEVERITY:
            print(
                f"fixture error: case {case['id']} expects unknown rule {case['expect']}",
                file=sys.stderr,
            )
            sys.exit(2)
    return cases


def run_selftest() -> int:
    failures = []
    passed = 0

    for case in parse_golden(GOLDEN_DIR / "should-fix.md"):
        rules = {f["rule"] for f in analyze(case["input"])}
        if case["expect"] in rules:
            passed += 1
        else:
            failures.append(
                f"should-fix/{case['id']}: 預期 {case['expect']}，實際 "
                f"{sorted(rules) or ['(無)']}"
            )

    for case in parse_golden(GOLDEN_DIR / "must-not-break.md"):
        fired = sorted(
            {f["rule"] for f in analyze(case["input"])} - case["ignore"]
        )
        if fired:
            failures.append(f"must-not-break/{case['id']}: 誤報 {fired}")
        else:
            passed += 1

    for line in failures:
        print(f"FAIL {line}")
    print(f"--- selftest: {passed} passed, {len(failures)} failed")
    return 1 if failures else 0


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="Lint zh-TW long-form prose for AI tells.")
    ap.add_argument("files", nargs="*", help="story file(s) to lint")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--strict", action="store_true", help="treat WARN as failure too")
    ap.add_argument("--selftest", action="store_true", help="run the golden fixtures")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(run_selftest())
    if not args.files:
        ap.error("no files given (use --selftest to run the golden fixtures)")

    errors = warnings = 0
    payload = []
    for name in args.files:
        path = Path(name).expanduser()
        if not path.exists():
            print(f"file not found: {path}", file=sys.stderr)
            sys.exit(2)
        findings = analyze(path.read_text(encoding="utf-8"))
        for f in findings:
            errors += f["severity"] == "ERROR"
            warnings += f["severity"] == "WARN"
            if not args.json:
                print(
                    f"{path}:{f['line']} [{f['severity']}] {f['rule']}: "
                    f"{f['text']} → {f['reason']}"
                )
        payload.append({"path": str(path), "findings": findings})

    if args.json:
        print(
            json.dumps(
                {"files": payload, "errors": errors, "warnings": warnings},
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"--- {errors} error(s), {warnings} warning(s)")

    sys.exit(1 if errors or (args.strict and warnings) else 0)


if __name__ == "__main__":
    main()
