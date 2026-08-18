# Config: L1 category story

A story organised around a **kind of thing** — a material, a craft, an L1
category. 「認識台灣工藝：精選 2026 文博會 6 家工藝品牌」 is the shape.

The reader arrives already knowing roughly what they are looking at and wants to
learn to tell things apart. The piece earns its place by making differences
visible.

## The trap this config exists to prevent

A L1 category story is still **editorial selection**, not a category listing.
The failure mode is a complete-looking roster of every brand in a category, which
is 收錄 wearing 選物's clothes — and the reader cannot tell the difference unless
the piece says so.

Two things keep it honest, and both belong in the prose:

- **Every brand carries a stated reason.** Not a description of what they make —
  a reason this piece includes them. If you cannot write the reason, that is a
  finding about the selection, not a wording problem.
- **The piece admits what it is not.** State that this is a cut, not a census,
  and that omission is not a verdict. One or two sentences, early.

## Shape

1. **Opening** — the reader's real problem with this category, concretely. What
   is hard to judge, what photographs flatten, what only shows up after use. No
   Formoria in the first 200 字.
2. **A flat fact block** early, carrying anything that changes how the reader
   should read the list — a booth being paid, exhibiting not being an
   endorsement, a source limitation. Flat register: no 語氣詞, no asides, no
   exclamation marks.
3. **The organising idea** — why this cut, stated plainly, with the selection
   criterion admitted as subjective.
4. **A `<BrandList>` of `<BrandLine slug booth note>`** as a table of contents,
   when the piece runs long enough that a reader will want to skip.
5. **Sections**, one per material or sub-type. Each opens with an *observation*
   about that material rather than a definition of it. Heading shape:
   `## <材料>｜<品牌>：<one-line hook>`.
   - A `<BrandGallery slug caption>` where the material is the point and photos
     carry it, or a `<BrandRow>` of three `<BrandCard>` where the section covers
     several brands. Three brands per section works: one gets a full paragraph,
     the other two share one.
   - Then prose carrying the five beats from `voice/brand-rules.md`.
6. **Close** — what survives after the shopping is done. One Formoria mention. A
   real question to the reader, not a rhetorical one.
7. **`---` then a `<Disclaimer>`** — image rights, no payment received, any
   volatile detail such as booth numbers.

## Rules specific to this shape

- **One concrete sensory or material detail per brand.** Not 「質感精緻」 but
  「邊緣沒有修得很整齊，拿兩個同款來比，花紋不會一樣」. This is what makes a
  L1 category piece worth reading and it is the first thing to go missing when
  facts are thin — a `[待確認]` marker is the correct output, not an adjective.
- **Tag with the L1 category slugs the story actually covers**, plus `event`
  and `creative-expo` when it is tied to an expo.
- **Headings may use an editorial gloss; link text uses the canonical taxonomy
  label.** 「瀏覽本站全部工藝文創品牌」 must land on a page whose heading agrees.
- A `[探索更多… →](/brands?category=<slug>)` link at the end of a section is
  service, not a CTA — it goes to the directory, not to a conversion.

## When this is the wrong config

If the organising idea is a **situation** rather than a **kind of thing** — if the
natural title starts with 「在…的時候」 or quotes something a reader would say —
use `discovery-trail.md`. A situation forced into category sections loses the
argument that made it worth writing.
