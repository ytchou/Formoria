---
item_id: "formoria/2026-07-21-intro-carousel"
title: "Formoria — ZH-TW intro carousel (8 cards)"
status: proposed
platforms: [ig, threads]
target_date: "2026-07-21"
lang: zh
total: 8
theme: marketing/cards/theme.json
templateDir: marketing/cards/templates
---

# Formoria — ZH-TW Intro Carousel Brief

8-card ZH-TW intro carousel for Formoria, a Taiwanese brand discovery and curation platform built on a community-contributed directory.
Consumed by `/content-cards` with `--config=marketing/cards/theme.json --template-dir=marketing/cards/templates lang=zh`.
Each card maps to a template (`cover.html` / `text.html` / `cta.html`) + a `background` (`{type, value, scrim-key}`) + a content `mode`.
Page counter format: `NN / 08`. v1 is ZH-TW only, manual posting.
Image-mode cards need a photo (founder-supplied or AI-generated) — paths marked as TODO.

---

## Card 01

```
type:               COVER
template:           cover.html
background.type:    image
background.scrim:   cover
image:              TODO images/cover.jpg (台灣職人 / 風景，暖色 editorial)
wordmarkZh:         Formoria
wordmarkEn:
headline:           像逛選物店一樣，發現台灣品牌
subhead:            台灣品牌探索與選物平台
footer:             formoria.com
pageNum:            01 / 08
```

⚠ TODO: cover headline/tagline pending founder sign-off

---

## Card 02

```
type:               TEXT
template:           text.html
mode:               big-statement
background.type:    color
background.value:   #2F5D50
tag:                關於 Formoria
headline:           讓台灣品牌更容易被看見、被選擇，也更容易成長。
footer:             Formoria
pageNum:            02 / 08
```

---

## Card 03

```
type:               TEXT
template:           text.html
mode:               prose
background.type:    dark
background.value:   #1C1C1C
tag:                為什麼
headline:           為什麼需要 Formoria？
body:               台灣有許多值得認識的品牌，但資訊散落在官網、社群、購物平台與實體通路。我們先把這些資料整理清楚，讓正在尋找的人更容易找到它們。
footer:             Formoria
pageNum:            03 / 08
```

---

## Card 04

```
type:               TEXT
template:           text.html
mode:               bullets
background.type:    image
background.scrim:   bullets
image:              TODO images/curation.jpg (工藝 / 材質特寫)
tag:                收錄方式
headline:           目錄收錄哪些品牌
bullets:
  - 在台灣創立、設計或製造
  - 品牌資料經人工審核後收錄
  - 製造驗證另外標示，不把收錄當認證
footer:             Formoria
pageNum:            04 / 08
```

---

## Card 05

```
type:               TEXT
template:           text.html
mode:               quote
background.type:    image
background.scrim:   quote
image:              TODO images/founder.jpg (創辦人 / 台灣日常)
tagAccent:          green
tag:                創辦人的話
quote:              在國外的那幾年，我最想念的，是台灣把生活做得很細緻的那份心意。
attribution:        — Formoria 創辦人
footer:             Formoria
pageNum:            05 / 08
```

⚠ TODO: founder quote wording pending sign-off

---

## Card 06

```
type:               TEXT
template:           text.html
mode:               keyword
background.type:    image
background.scrim:   bullets
image:              TODO images/discover.jpg (品類拼貼 / 多樣產品平拍)
tag:                怎麼用
headline:           從你關心的開始逛
body:               依品類、特色與購買通路探索食品、家居、服飾、保養等品牌，找到下一個真正適合你的選擇。
footer:             Formoria
pageNum:            06 / 08
```

---

## Card 07

```
type:               TEXT
template:           text.html
mode:               numbered
background.type:    color
background.value:   #2F5D50
tag:                看得見的信任
headline:           三種信任訊號
numbered:
  1. MIT 微笑認證 — 比對台灣製造登錄資料
  2. 社群共編 — 社群提供資料，Formoria 人工審核
  3. 品牌經營 — 品牌親自認領與維護
footer:             Formoria
pageNum:            07 / 08
```

---

## Card 08

```
type:               CTA
template:           cta.html
background.type:    color
background.value:   #C4693B
tag:                一起
headline:           在 formoria.com 探索台灣品牌
ctaLabel:           追蹤 Formoria
ctaNote (IG):       連結在簡介
ctaNote (Threads):  formoria.com
footer:             Formoria
pageNum:            08 / 08
```

---

## TODOs — Founder Sign-Off Pending

- [ ] COVER headline/tagline (Card 01)
- [ ] Founder quote wording (Card 05)
- [ ] Logo SVG wordmark asset (theme `brand.logo` is null — the Formoria text wordmark is the v1 placeholder)
- [ ] IG / Threads account handles (for CTA bio link + cross-linking)
- [ ] Background photos for image-mode cards (01, 04, 05, 06) — founder-supplied or AI-generated, pre-cropped 1080×1350
