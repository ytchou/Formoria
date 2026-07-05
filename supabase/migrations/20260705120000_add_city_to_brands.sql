ALTER TABLE brands ADD COLUMN city text;

ALTER TABLE brands ADD CONSTRAINT brands_city_check
  CHECK (city IS NULL OR city = ANY(ARRAY[
    'taipei','new_taipei','taoyuan','taichung','tainan','kaohsiung',
    'keelung','hsinchu_city','chiayi_city',
    'hsinchu_county','miaoli','changhua','nantou','yunlin',
    'chiayi_county','pingtung','yilan','hualien','taitung',
    'penghu','kinmen','lienchiang'
  ]));

CREATE INDEX idx_brands_city ON brands(city) WHERE city IS NOT NULL;