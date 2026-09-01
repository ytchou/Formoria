-- Product saves — lets authenticated users bookmark/favorite curated products
CREATE TABLE IF NOT EXISTS product_saves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES curated_products (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, product_id)
);

ALTER TABLE product_saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own saves"
ON product_saves FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saves"
ON product_saves FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saves"
ON product_saves FOR DELETE
USING (auth.uid() = user_id);

CREATE INDEX idx_product_saves_user_id ON product_saves (user_id);
CREATE INDEX idx_product_saves_product_id ON product_saves (product_id);
