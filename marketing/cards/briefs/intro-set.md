---
title: "Formoria 島藏 — ZH-TW intro carousel (8 cards)"
lang: zh
total: 8
theme: marketing/cards/theme.json
templateDir: marketing/cards/templates
platforms: "IG (CTA note 連結在簡介) · Threads (CTA note formoria.com)"
status: "DRAFT — founder sign-off pending (see TODOs)"
---

# Formoria 島藏 — ZH-TW Intro Carousel Brief

8-card ZH-TW intro carousel for Formoria / 島藏 (a community-curated Made-in-Taiwan brand directory).
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
wordmarkZh:         島藏
wordmarkEn:         Formoria
headline:           台灣製造，值得被收藏
subhead:            社群共同策展的台灣製造品牌指南
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
tag:                關於島藏
headline:           把散落各地的台灣製造，收進同一座島。
footer:             島藏 Formoria
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
headline:           為什麼是台灣製造？
body:               因為這裡有把事情做好的職人，有願意慢慢來的品牌，有值得被更多人看見的設計與用心。台灣製造，不只是產地，而是一種選擇。
footer:             島藏 Formoria
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
tag:                策展標準
headline:           我們怎麼挑選品牌
bullets:
  - 真正在台灣設計或製造
  - 對材質與工藝誠實
  - 由社群推薦、共同把關
footer:             島藏 Formoria
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
footer:             島藏 Formoria
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
body:               依品類、產地與工藝探索 — 食品、家居、服飾、保養⋯⋯ 找到屬於你的台灣製造。
footer:             島藏 Formoria
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
headline:           三種信任標記
numbered:
  1. MIT 微笑認證 — 比對台灣製造登錄資料
  2. 社群策展 — 由真實使用者推薦
  3. 品牌經營 — 品牌親自認領與維護
footer:             島藏 Formoria
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
headline:           在 formoria.com 探索台灣製造
ctaLabel:           追蹤島藏
ctaNote (IG):       連結在簡介
ctaNote (Threads):  formoria.com
footer:             島藏 Formoria
pageNum:            08 / 08
```

---

## TODOs — Founder Sign-Off Pending

- [ ] COVER headline/tagline (Card 01)
- [ ] Founder quote wording (Card 05)
- [ ] Logo SVG wordmark asset (theme `brand.logo` is null — text wordmark 島藏 / Formoria is the v1 placeholder)
- [ ] IG / Threads account handles (for CTA bio link + cross-linking)
- [ ] Background photos for image-mode cards (01, 04, 05, 06) — founder-supplied or AI-generated, pre-cropped 1080×1350
