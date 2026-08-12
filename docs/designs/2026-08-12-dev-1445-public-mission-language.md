# DEV-1445 — Public Mission and zh-TW Voice System

## Goal

Give every Formoria surface one public language system for moving from a
person's situation or curiosity to a Taiwanese product, the brand behind it,
and an honest official or physical next step. The guide distinguishes the
inclusive directory from deliberate editorial selection and from commercial
participation.

This standard is approved on 2026-08-12. It is a documentation and editorial
governance change, not an application implementation.

## Canonical language governance

zh-TW is Formoria’s canonical public language; English currently serves as a
faithful translation; when they diverge, resolve in favor of intended zh-TW
meaning and Taiwanese POV.

### Four-level hierarchy

#### Mission

Canonical zh-TW:

> Formoria 把從靈感走到購買中間斷掉的路接回來，幫助人從自己想要的生活出發，找到適合的台灣產品、認識背後的品牌，也知道可以去哪裡購買。

Current faithful English translation:

> Formoria reconnects the broken path from inspiration to purchase by helping people start with the life they want, find Taiwanese products that suit them, get to know the brands behind them, and know where to buy.

#### Product promise

> 從你的情境、用途或偏好開始，Formoria 挑出值得細看的產品、說清楚為什麼選它，再帶你前往品牌自己的官方通路。

This is an approved editorial/content standard. It must not be presented as a
shipped capability until the first complete `主題選物` exists.

#### Present positioning

> Formoria 是台灣品牌探索與選物平台。目前從可搜尋的品牌收錄出發，整理品牌資料、產品特色與官方購買通路；由 Formoria 挑選的內容會另外標示。

This describes the current directory foundation and the separately labelled
editorial subset. It does not claim that Formoria is a retailer, marketplace,
stockist, or transaction processor.

#### Vision

> 打造一個台灣品牌線上選物空間，讓人可以慢慢逛、找到新的偏好，認識產品背後的品牌，再前往品牌官方或實體通路。

This is a future experience, not a claim that Formoria currently takes orders,
holds inventory, fulfils purchases, or provides after-sales service.

## Public terminology and trust boundaries

| Public label | Meaning | Boundary |
| --- | --- | --- |
| `收錄品牌` | A brand that meets Formoria’s directory rules and can be found in the searchable record. | Inclusion is not Formoria endorsement, selection, certification, ranking, or a promise about current products. |
| `Formoria 選物` | A product or content item deliberately chosen for a stated situation, use, preference, or editorial argument. | The rationale belongs to Formoria; it is not a claim that the item is universally best or the complete brand catalogue. |
| `品牌提供` | Facts, images, sources, or corrections supplied by a brand. | Information supplied does not guarantee coverage or give the brand control over selection, ordering, rationale, or interpretation. |
| `贊助內容` | Paid or commercial content. | It is clearly labelled and visually/structurally distinct; it cannot enter organic selection or ranking logic, and relevant relationships are disclosed at the point of action. |

`選物` is reserved for deliberate editorial choices. Directory inclusion uses
`收錄`. A brand’s responsiveness, payment, search position, media kit, or data
completeness is never a substitute for editorial selection.

`主題選物` is the public label for Discovery Trails. It is a reader-facing
content/experience label only: it does not rename the internal model, route,
URL, schema, or implementation. URL and route naming remain deferred. Five-
reader validation of the label is a later route-implementation gate, not a
DEV-1445 blocker.

## Approved voice sequence

Every mission-bearing passage should move in this order:

1. 從讀者當下的情境、需要或好奇開始。
2. 說明產品在這個情境裡扮演的實際或感受上的角色。
3. 交代 Formoria 為什麼把它放在這裡，讓編輯判斷和事實分開。
4. 認識品牌，補上必要且有來源的背景。
5. 提供前往品牌官方網站或實體通路的下一步，不施壓、不保證庫存或結果。

The route onward is useful information, not a hard sell. Brand or retailer
destinations own price, variants, inventory, checkout, fulfilment, and
after-sales claims.

## Vocabulary rules

- Write natural Taiwan Mandarin, not translated English rhythm or
  China-Mandarin with character conversion. Use full-width punctuation in
  Chinese: `「」`、`，`、`。`、`：`、`；`、`！`、`？`、`（ ）`、`．`.
- Use concrete nouns, observable details, and source-backed facts. Mark
  Formoria’s interpretation as interpretation. Avoid generic praise such as
  「高級」、「頂級」、「療癒」、「生活風格」 when no specific observation
  supports it.
- Do not use 「最好」、「必買」、「首選」、「人氣第一」 or an unmethodised
  ranking. Do not imply certification, safety, efficacy, availability, stock,
  price, discount, delivery, or a guarantee.
- Keep 「台灣品牌」 factual. Distinguish 「在台灣成立」、「由台灣團隊經營」、
  「在台灣設計」 and 「台灣製造」 when the source supports the distinction.
- Say `收錄` for directory membership and reserve `選物` for deliberate
  editorial choices. Neither label may hide sponsorship or brand-provided
  material.
- Use honest continuation labels such as 「前往品牌官方網站」、「查看品牌官方
  通路」 and 「前往實體通路」. Avoid 「立即購買」、「保證有貨」 and urgency or
  transaction promises Formoria cannot own.
- The product promise is an approved standard, not a shipped capability until
  the first complete `主題選物` exists.

## Eight context checks

Each pair is a context test. Good copy starts with a situation, gives a
concrete reason, separates fact from Formoria’s judgment, and offers an honest
route onward. Bad copy uses generic praise, pressure, unsupported claims, or
directory/editorial confusion.

1. **Home**

   - Good: 「租屋處的床邊只需要一小塊光；我們選這盞燈，是因為它的尺寸和照射方向適合放在閱讀角，實際規格請以品牌官方頁面為準。」
   - Bad: 「用這盞台灣精品燈，立刻升級你的高級生活。」

2. **Food**

   - Good: 「想替兩個人的晚餐找一瓶不搶味的台灣茶，可以先看這款；我們選它，是因為品牌標示的焙火描述和適合冷泡的方式，仍請以官方資訊為準。」
   - Bad: 「全台最好喝、送禮必買，現在不買就錯過。」

3. **Fashion**

   - Good: 「如果你在找適合通勤、又不想被單一身形想像限制的上衣，可以從這件的版型與尺寸表開始看；Formoria 選它，是因為穿著情境和材質資訊說得清楚。」
   - Bad: 「顯瘦神品，任何人穿都完美。」

4. **Craft**

   - Good: 「這件器物的手作痕跡清楚可見；我們把它放在這條主題選物，是因為它能讓日常使用看見製作者對材質的處理，工法與產地以來源說明為準。」
   - Bad: 「職人匠心打造的傳世珍品，收藏家都該擁有。」

5. **Beauty**

   - Good: 「在意使用觸感而不先預設效果的人，可以從成分、用法與適用資訊開始比較；我們選這款，是因為品牌公開資料完整，不把它寫成治療或效果保證。」
   - Bad: 「天然無負擔，讓肌膚重生的必買保養。」

6. **Outdoor**

   - Good: 「週末短程步道需要的是好收納、能看懂用途的裝備；我們選它，是因為官方規格清楚，適合的活動強度仍由使用者依自身狀況判斷。」
   - Bad: 「台灣第一戶外裝備，登山探險都靠它。」

7. **Family**

   - Good: 「和孩子一起使用時，先看尺寸、材質、清潔方式與照顧者的實際動線；這是 Formoria 在這個情境裡挑出的選物，不代表適合所有家庭或取代專業建議。」
   - Bad: 「每個幸福家庭都需要這個，買給孩子就對了。」

8. **Pet**

   - Good: 「和寵物一起生活，可以先從空間、清潔習慣與動物個別狀況想起；我們選這件，是因為品牌提供的尺寸與材質資料容易查找，使用前仍應依寵物需要判斷。」
   - Bad: 「毛孩爸媽必買，保證讓每隻寵物都更健康。」

## Inclusive-language review

- **Tastes:** Include more than one aesthetic, familiarity level, and degree of
  commitment across the portfolio. Never treat Formoria’s current taste as
  universal.
- **Budgets:** Do not equate price with taste, care, or quality. When price is
  not maintained, describe use, material, scale, or commitment rather than
  inventing price tiers.
- **Households:** Write for people living alone, with partners, with friends,
  multigenerational households, chosen families, caregivers, and households
  without children. Do not call one arrangement normal.
- **Regions:** Do not treat Taipei or one urban lifestyle as Taiwan. Name a
  place only when relevant and sourced, and keep official and physical routes
  useful beyond one region where possible.
- **Bodies and abilities:** Do not make thinness, youth, able-bodiedness,
  sensory ability, or speed the default. Give dimensions, access conditions,
  alternatives, and caveats when relevant without turning people into problems
  to solve.
- **Identities:** Do not assume gender, sexuality, ethnicity, religion,
  nationality, family role, or language. Use a person’s or community’s own
  terms when known, and never use cultural identity as decorative vocabulary.
- Review who is missing, who is treated as the default, and whether a
  constraint has been framed as a defect. Do not promise universal fit.

## Founder and AI review checklist

Before publishing mission-bearing copy, the founder or accountable editor
checks all twelve points:

- [ ] The copy starts from a real situation, need, use, mood, or curiosity.
- [ ] The approved Mission, Product promise, Present positioning, and Vision
      are reproduced without drift.
- [ ] Directory inclusion is labelled `收錄品牌`; deliberate editorial choices
      are labelled `Formoria 選物`.
- [ ] `品牌提供` and `贊助內容` are clearly distinguished from organic
      selection.
- [ ] `主題選物` is used as a public label only; no route, URL, schema, or
      internal-model rename is implied.
- [ ] Every factual claim has an official or otherwise recorded source;
      interpretation is recognisably Formoria’s judgment.
- [ ] No unsupported sales, stock, price, discount, certification, safety,
      efficacy, ranking, superiority, guarantee, or universal-fit claim appears.
- [ ] The product promise is not presented as shipped capability before the
      first complete `主題選物` exists.
- [ ] The next step points to an honest official or physical route and does not
      pressure the reader.
- [ ] Taiwan Mandarin, full-width punctuation, genericity, and translated or
      China-Mandarin wording have been checked.
- [ ] Tastes, budgets, households, regions, bodies/abilities, and identities
      are not treated as one default.
- [ ] AI-assisted research or drafting did not make the final selection,
      cultural interpretation, or publication decision.

## Source-fidelity contract

This standard carries forward the decisions in the three governing guides:

| Source | Fidelity requirement in this standard |
| --- | --- |
| Formoria Discovery Product & Delivery Strategy | Product-first discovery; factual catalog, editorial interpretation, and published experience stay distinct; brand pages are canonical; official site precedes marketplaces; no price or inventory maintenance; human selection and rationale remain owned by editors. |
| Formoria SEO & Content Strategy | Search demand may suggest questions, but Formoria owns every answer; one canonical owner per intent; `主題選物` does not approve a route rename; no thin product pages, volatile commerce claims, or rankings; trails link through selected products to brands and official channels. |
| Formoria Editorial Governance & Brand Relations | Directory inclusion is broad and rule-based; editorial inclusion is selective and contextual; brand cooperation improves factual confidence but never guarantees coverage or control; sponsorship is distinct from organic selection; AI cannot be the accountable editor. |

Any future copy or implementation that conflicts with a fixed boundary must
update and re-approve the governing strategy before changing this standard.

## Red-team gates

Reject or revise copy that implies any of the following without an explicit,
supported and appropriately labelled basis:

- Formoria sells, stocks, processes transactions, fulfils orders, or controls
  after-sales service.
- A product is available, in stock, discounted, safe, certified, effective, or
  guaranteed.
- A product or brand is the best, number one, universally suitable, or ranked by
  a method that has not been disclosed.
- A brand’s directory inclusion, responsiveness, supplied material, payment, or
  relationship caused editorial selection.
- Search position or taxonomy membership is editorial endorsement.
- A brand-provided statement is Formoria’s independent judgment.
- The future select-shop vision or product promise is already a shipped
  commerce or Trail capability.

## DEV-1446 downstream copy alignment

DEV-1445 records current public-copy conflicts but does not edit application
messages or other strategy documents. DEV-1446 must reconcile:

- `footer.tagline`: 「讓台灣品牌更容易被看見」.
- `landing`: current metadata, hero, and manifesto copy that overstates brand
  promotion or selection.
- `about.mission.statement`: 「讓台灣品牌更容易被看見、被選擇，也更容易成長。」
- `vision`: current copy that presents the future direct-order/select-shop model
  as current.

`messages/zh-TW.json` is explicitly out of scope for DEV-1445.

## Implementation boundary

- Update only the existing canonical Notion guide in place after the numbered
  preview is acknowledged and the page is fetched immediately beforehand.
- Use the smallest targeted replacements; preserve its roadmap, child content,
  and unrelated strategy material.
- Do not rename routes, URLs, models, schemas, interfaces, or translations.
- Do not change Linear status or any other strategy page.

## Pre-mortem

**Load-bearing assumption:** Formoria can express a clear Taiwanese point of
view while keeping inclusion, editorial judgment, brand participation, and
commercial content visibly separate.

**What breaks silently:** a translation-sounding or generic AI draft preserves
facts but gradually turns `收錄品牌` into implied endorsement, treats one taste
or household as universal, or presents a route and product promise as already
shipped.

**Guard:** zh-TW canonical governance, the exact hierarchy statements, source
fidelity review, eight context tests, inclusive-language review, the founder/AI
checklist, explicit downstream handoff, and red-team checks before publication.
