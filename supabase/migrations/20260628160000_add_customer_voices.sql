ALTER TABLE brands ADD COLUMN IF NOT EXISTS customer_voices jsonb DEFAULT '[]'::jsonb;
