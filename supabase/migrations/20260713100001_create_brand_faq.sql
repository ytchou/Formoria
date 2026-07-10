CREATE TABLE brand_faq (
  brand_id uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  faq_mit jsonb,
  faq_where_to_buy jsonb,
  faq_products jsonb,
  faq_price jsonb,
  faq_founded jsonb,
  faq_reputation jsonb,
  faq_custom_1 jsonb,
  faq_custom_2 jsonb,
  faq_custom_3 jsonb,
  faq_custom_4 jsonb,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE brand_faq IS 'Enrichment-generated FAQ per brand. Each column stores {question_zh, answer_zh, question_en, answer_en} or null.';
