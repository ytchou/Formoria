create table marketing_calendar (
  id text primary key,
  title text not null,
  type text not null check (type in ('idea','brand-highlight','event','milestone','trend','series')),
  status text not null default 'idea' check (status in ('idea','brief','scheduled','producing','review','published','archived')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  target_date date,
  platforms text[] not null default '{}',
  media text check (media in ('text-only','carousel','video','both')),
  lang text not null default 'zh' check (lang in ('zh','en')),
  source_type text,
  source_detected_by text,
  source_detected_at date,
  source_url text,
  brief_path text,
  output_path text,
  todoist_task_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index marketing_calendar_target_date_idx on marketing_calendar (target_date);
create index marketing_calendar_status_idx on marketing_calendar (status);
alter table marketing_calendar enable row level security;

insert into marketing_calendar (id, title, type, status, priority, target_date, platforms, media, lang, source_type, source_detected_by, source_detected_at, brief_path, notes, created_at, updated_at) values
('2026-06-15-launch-announcement','島藏正式上線 — 台灣製造品牌目錄','milestone','published','high','2026-06-15','{threads,ig}','carousel','zh','milestone','manual','2026-06-10',null,'Launch day post. Published manually before calendar system existed.','2026-07-20T10:00:00+08:00','2026-07-20T10:00:00+08:00'),
('2026-07-22-brand-count-350','島藏收錄突破 350 個台灣製造品牌','milestone','brief','medium','2026-07-22','{threads,ig}','carousel','zh','milestone','manual','2026-07-18','marketing/briefs/2026-07-22-brand-count-350.md',null,'2026-07-20T10:00:00+08:00','2026-07-20T10:00:00+08:00'),
('2026-07-25-ceramics-festival','台灣國際陶藝雙年展 — 島藏有收錄的參展品牌','event','scheduled','high','2026-07-25','{threads,ig}','carousel','zh','event','routine','2026-07-20','marketing/briefs/2026-07-25-ceramics-festival.md','Biennial runs Aug 1-Oct 31. Tie-in with local brands.','2026-07-20T10:00:00+08:00','2026-07-20T10:00:00+08:00'),
('2026-07-28-summer-skincare','夏日防曬保養 — 台灣製造的護膚選擇','series','idea','low','2026-07-28','{threads,ig}',null,'zh','trend','manual','2026-07-20',null,null,'2026-07-20T10:00:00+08:00','2026-07-20T10:00:00+08:00');
