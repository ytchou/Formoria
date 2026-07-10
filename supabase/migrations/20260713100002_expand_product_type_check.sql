-- Expand product_type CHECK from 10 to 12 categories:
-- Split outdoor (戶外運動保健) → outdoor (戶外露營) + fitness (運動健身)
-- Split crafts (工藝文創) → crafts (工藝文創) + stationery (文具設計)

ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_product_type_check;

ALTER TABLE brands ADD CONSTRAINT brands_product_type_check
  CHECK (product_type IN (
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home', 'food-drink',
    'crafts', 'stationery', 'tech', 'outdoor', 'fitness', 'kids-pets'
  ));
