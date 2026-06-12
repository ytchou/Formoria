-- Brand saves — lets authenticated users bookmark/favorite brands
CREATE TABLE IF NOT EXISTS brand_saves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    brand_id UUID NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, brand_id)
);

ALTER TABLE brand_saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own saves"
ON brand_saves FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saves"
ON brand_saves FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saves"
ON brand_saves FOR DELETE
USING (auth.uid() = user_id);

CREATE INDEX idx_brand_saves_user_id ON brand_saves (user_id);
CREATE INDEX idx_brand_saves_brand_id ON brand_saves (brand_id);
