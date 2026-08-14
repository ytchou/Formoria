# Config: discovery trail（主題選物）

A story organised around a **reader's situation** — 「在小空間裡，留一個閱讀角落」,
「小空間也能招待一兩位朋友」, 「讓通勤少一點負擔」.

The reader does not know the product name. They know how they want their life to
feel. This is the shape closest to Formoria's mission: it repairs the broken path
from inspiration to purchase, which a keyword search cannot do because the reader
has no keyword.

Candidate situations and their per-candidate watch-outs live in the DEV-1427
Discovery Trail Candidate Portfolio. Read the candidate's brief before drafting
if the situation came from there.

## What makes it a trail rather than a category page

A trail earns the name by holding a **cross-category argument**. If every product
in the slate comes from one category, the situation was decoration — the piece is
a category page with a nicer title, and it should be filed as one.

**Hard rule: no single L2 product subcategory may exceed half the slate.**
DEV-1427 states it for lighting in the reading-corner candidate; it generalises.
The moment lighting is six of ten, it is a Lighting page wearing a trail's title.

If you cannot get under half without padding, that is real evidence: the
situation is not yet a trail. Say so in the hand-off instead of forcing it.

## Shape

1. **Opening — the reader's situation, in their own words.** A sentence they
   would actually say: 「家裡不大，但我想留一個能好好讀幾頁書的角落。」 Not a
   product category, not a trend, not a season. The rest of the opening stays on
   the situation: what is actually hard about it, what people try first and why
   it does not hold.
2. **A flat fact block** carrying the editorial position — that this is a
   selection with a stated basis, that no payment was involved, and that price,
   stock, and specifications belong to the brand.
3. **Sections are branches of the situation, never category names.** For a
   reading corner: 現成桌面 / 座位旁邊 / 可以移動的做法. For hosting: 彈性的桌與
   坐 / 茶飲 / 盛裝 / 客人走了以後. A heading that says 燈飾 or 家具 has already
   lost the argument.
4. **Every product states its role in that situation** — not its features. 「這盞
   的尺寸和照射方向適合放在閱讀角」 is a role. 「北歐風極簡設計」 is not. A product
   whose role you cannot state does not belong in the slate.
5. **An explicit exclusions note.** What was considered and deliberately left
   out, and why. Recording rejections is part of the editorial system, not wasted
   work — and it is the clearest signal to the reader that a judgment happened.
6. **Close** — the honest next step. Official site or physical stockist, no
   pressure, no stock promise.
7. **`<Disclaimer>`** — selection basis, no commercial relationship, and the
   pointer that specifications live with the brand.

## Rules specific to this shape

- **Order the sections the way the situation actually unfolds**, not by category
  or by price. If one thing has to be solved before the others matter, say so and
  put it first — that sequence is most of the article's value.
- **Do not claim an outcome.** No better sleep, no calm, no reduced anxiety, no
  focus, no eye protection. The situation may be emotional; the claims may not be.
  This is the single most likely violation in this shape, because the situations
  themselves are about how life feels.
- **State constraints as constraints, not defects.** A rental that cannot take
  wall fixings, a shared room, a small budget — these are conditions to design
  around, not problems with the reader.
- **Check the defaults before hand-off.** Household type is the one this shape
  gets wrong most: a baseline draft assumed a co-resident throughout and only
  noticed afterwards. Someone living alone must be able to read the whole piece
  without being written around. Same for budget, region, and body.
- **Tag with the L1 product category that best describes the trail**, such as
  `home` for a reading-corner trail. One L1 tag is valid; diversity is evaluated
  entirely by the L2 product subcategories represented in the slate.

## Shipped: the Trail surface

「主題選物」 is the reader-facing label. "Trail" is the internal content-model
term and does not appear in prose. Published trails live in `content/trails/`
and the reader-facing surface is `/discover/<slug>`. Keep the route out of prose
unless the reader needs a link; sections remain branches of the situation, not
product-category labels.
