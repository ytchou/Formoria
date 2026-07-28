INSERT INTO brand_slug_redirects (old_slug, new_slug)
SELECT mappings.old_slug, mappings.new_slug
FROM (VALUES
  ('cicala-pu-喜樂鋪手工鞋', 'cicala-pu'),
  ('colorsmith-台灣原創品包包品牌', 'colorsmith'),
  ('change-tone-年中慶-全館滿千-8-折-每日百元折價券-滿299免運-6-18-6-22', 'change-tone'),
  ('photofast-銀箭', 'photofast'),
  ('tumaz月熊', 'tumaz'),
  ('rewood木酢達人', 'rewood'),
  ('光引-quoin', 'quoin'),
  ('leeds-weather-色彩個性襪子品牌', 'leeds-weather'),
  ('鹿苑茶莊1935-以茶為媒-述說台灣島嶼的故事與溫暖', '1935'),
  ('fartech翻頁鐘', 'fartech'),
  ('沙伯迪澳', 'sobdeall'),
  ('desrochers-x-曜生活', 'desrochers-x'),
  ('southgate南登機口', 'southgate'),
  ('嗨-我是陶氣小姐', '陶氣小姐'),
  ('hh健康於筷', 'hh-healthy-happy'),
  ('沐澧-mooni', 'mooni')
) AS mappings(old_slug, new_slug)
JOIN brands ON brands.slug = mappings.new_slug
  AND brands.status = 'approved'
ON CONFLICT (old_slug) DO NOTHING;
