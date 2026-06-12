-- MIT Map: Seed region taxonomy tags
-- Safe to run multiple times (idempotent via ON CONFLICT)

INSERT INTO taxonomy_tags (name, name_zh, slug, category, is_active)
VALUES
('Nationwide', '全台灣', 'nationwide', 'region', true),
('Taipei', '台北市', 'taipei', 'region', true),
('New Taipei', '新北市', 'new-taipei', 'region', true),
('Taoyuan', '桃園市', 'taoyuan', 'region', true),
('Taichung', '台中市', 'taichung', 'region', true),
('Tainan', '台南市', 'tainan', 'region', true),
('Kaohsiung', '高雄市', 'kaohsiung', 'region', true),
('Keelung', '基隆市', 'keelung', 'region', true),
('Hsinchu City', '新竹市', 'hsinchu-city', 'region', true),
('Hsinchu County', '新竹縣', 'hsinchu-county', 'region', true),
('Miaoli', '苗栗縣', 'miaoli', 'region', true),
('Changhua', '彰化縣', 'changhua', 'region', true),
('Nantou', '南投縣', 'nantou', 'region', true),
('Yunlin', '雲林縣', 'yunlin', 'region', true),
('Chiayi City', '嘉義市', 'chiayi-city', 'region', true),
('Chiayi County', '嘉義縣', 'chiayi-county', 'region', true),
('Pingtung', '屏東縣', 'pingtung', 'region', true),
('Yilan', '宜蘭縣', 'yilan', 'region', true),
('Hualien', '花蓮縣', 'hualien', 'region', true),
('Taitung', '台東縣', 'taitung', 'region', true),
('Penghu', '澎湖縣', 'penghu', 'region', true),
('Kinmen', '金門縣', 'kinmen', 'region', true),
('Lienchiang', '連江縣', 'lienchiang', 'region', true)
ON CONFLICT (slug) DO UPDATE
    SET
        name = EXCLUDED.name,
        name_zh = EXCLUDED.name_zh;
