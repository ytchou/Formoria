# Kill list — what must not appear

The negative half of the voice spec. `persona.md` holds the positive half.

Every rule here is phrased as an **absence** ("must not contain X"), on purpose.
Rubric-driven writing systems reliably degrade when their criteria are mostly
presence-based ("does it contain X") — the measured failure mode is that the
score rises while conciseness and overall quality fall. Absence criteria are
what protect the dimensions nobody is optimising.

**These rules flag; they never authorise a silent rewrite.** A draft that trips
a rule surfaces it for a human decision. A model rewriting its own prose toward
a checklist reproduces its own blind spots and flattens the result.

Mechanical enforcement: `python3 scripts/story-lint/check.py <file.mdx>`.

---

## Tier 1 — appears once, the piece is made

| Kill | Replace with |
|---|---|
| `——` used to append an aside | 逗號、句號, or split into two sentences |
| 「不是 A，而是 B」／「不只是…而是…」／「不僅…更…」 | Two plain statements, or an 「以為…其實…」 reversal |
| Three-part parallelism — **exactly three** 、-joined short phrases (讀懂、拆解、生成) | Keep one set per article at most; make the rest running prose. A list of four or more concrete nouns is a catalogue, not this tell, and is not flagged. |
| 質量／水平 | 品質／水準 |
| 視頻／屏幕／菜單／激活／默認 | 影片／螢幕／選單／啟用／預設 |
| 走心／給力／接地氣 | 用心／很強／貼近生活 |

### On 破折號 — a density rule, not a ban

Target zero. The linter errors above **1 occurrence per 500 CJK characters**.

The honest position: the full-width 破折號 is legitimate 教育部-sanctioned
punctuation, and a defensible rule would flag only *western* usage — a
half-width em dash inside a Chinese sentence, or a dash used as an all-purpose
connector. But Taiwanese readers currently penalise the mark on sight; it has
been named in mainstream coverage as the single most recognisable AI tell.
Perception is what we are writing against, so the density cap stands. It is
encoded as a threshold rather than a ban so the position can be revised without
rewriting the rule.

### On 「不是 A 而是 B」 — one is human, several is a tell

At most **one** per article. Not zero.

A Taiwanese blogger measured his own 4,036 posts (3.38M characters): the
construction appears once per roughly 24,000 characters. The AI sample he
compared against ran once per 144. The pattern is ordinary Chinese; only its
density is diagnostic. Banning it outright produces prose stricter than a real
writer's, which is its own kind of artefact.

## Tier 2 — corporate stiffness and machine syntax

| Kill | Replace with |
|---|---|
| 您／消費者／各位讀者 | 你／大家 |
| 進行研究、作出改良、實現升級 | 研究、改良、升級 |
| 具有…的特色／擁有…的優勢 | Say what it did |
| 因此／綜上所述／總的來說／值得一提的是 | 所以／講白一點／delete |
| 被…所… | Active voice |
| 強大／全面／精緻／獨特 | A material, a size, a price, a texture |
| 標誌著／見證了／奠定基礎／轉捩點／里程碑 | Delete; state the fact |
| 業界專家普遍認為／研究顯示 (no source) | Name the source or cut the claim |

## Tier 3 — fine grain

| Kill | Replace with |
|---|---|
| 「的」 denser than roughly one per 15 字 (minimum allowance 2) | Re-read and delete the ones carrying no weight |
| 品牌們／設計師們 | Drop 們 |
| Long pre-modifiers stacked before the noun | Move the modifier after the verb |
| 「！」 in body prose | Keep for headings only |
| Three or more consecutive sentences of near-identical length | Break one of them |

## Tier 4 — 假人味: the failure mode of de-AI-ing itself

The characteristic way this whole exercise goes wrong is producing a *second,
folksier AI dialect*: prose that has had its stiffness removed and a performance
of humanity added in its place. Both the Formoria voice review and the leading
zh-TW de-AI rule set identified this independently, which is why it gets its own
tier.

**Never, under any circumstances:**

- **Invent an experience the author did not have.** 「我把 552 個攤位走完了」 and
  「我自己去年就是這樣」 are fabrications when the list was assembled from a
  published exhibitor roster. 小編 may have a personality; he may not have a
  fake biography. This is the single hardest rule in the file and the easiest to
  break while trying to sound warm.
- **Perform colloquialism.** 語氣詞 added to a sentence that had no feeling in it
  does not make it human; it makes it 尬.
- **Perform uncertainty.** Manufactured hedging (「我也不太確定啦」) to seem
  approachable, when the fact is actually known.
- **Write a 金句 closing.** 「在未來的道路上」「值得我們細細品味」「未來可期」 and
  every motivational-poster ending.
- **Insert a reversal the author never made.** If the source says one thing, the
  draft does not manufacture a "but actually" turn to create narrative shape.

## Protected — must survive untouched

A linter that over-fires gets switched off. These are never flagged and never
rewritten:

- **Proper nouns**, including brand and platform names that happen to contain a
  banned substring.
- **Anything inside 「」 quotation marks** — quoted speech is the source's
  wording, not ours.
- **A term being mentioned rather than used.** 「我最近盡量不寫『不是A而是B』這種句型」
  discusses the pattern; it does not commit it.
- **Numbers, dates, booth codes, prices, URLs, slugs.**
- **Numeric ranges with an en dash** (8/6–8/12) — not an em dash.
- **Fenced code blocks and MDX shortcode attributes.**
