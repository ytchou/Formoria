-- Purge legacy NT$ figures that the DEV-1317 backfill imported into
-- `price-positioning`.
--
-- 20260805140000 mapped the legacy `faq_price` column into
-- `preset_id = 'price-positioning'`. Those answers were generated under a
-- prompt that asked for concrete NT$ amounts, while the new preset's prompt
-- forbids currency outright and its validator list includes
-- `noPricingFigures()`. Validators only ever run on fresh model output —
-- `getBrandFaq` renders stored rows verbatim — so the imported amounts render
-- on the brand page and are published as FAQPage structured data, breaking the
-- "no generated FAQ answer contains an NT$ figure" acceptance criterion.
--
-- 20260805140000 has already been applied to production, so restricting its
-- WHERE clause (done in the same change, for databases built from scratch)
-- cannot clean up the rows that are already there. This migration does that.
--
-- Deleting rather than nulling is deliberate: every affected row is
-- `source = 'model'`, the `faq` phase regenerates them from live evidence on
-- the next explicit run, and the template floor renders the price question in
-- the meantime — so the page never goes empty. `source = 'human'` rows are
-- never touched, here or anywhere else.
--
-- The pattern mirrors `noPricingFigures()` in
-- src/lib/brands/faq-presets/validators.ts. Keep the two in step.

delete from public.brand_faq_entries
where preset_id = 'price-positioning'
  and source = 'model'
  and (
    coalesce(answer_zh, '') ~* '(NT\s*[$＄]|TWD|新台幣|\d[\d,]*(\.\d+)?\s*(元|塊|NT\s*[$＄]|TWD)|[$＄]\s*\d[\d,]*)'
    or coalesce(answer_en, '') ~* '(NT\s*[$＄]|TWD|新台幣|\d[\d,]*(\.\d+)?\s*(元|塊|NT\s*[$＄]|TWD)|[$＄]\s*\d[\d,]*)'
  );
