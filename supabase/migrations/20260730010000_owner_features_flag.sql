-- ---------------------------------------------------------------------------
-- 1. Owner features kill switch (default OFF until launch)
-- ---------------------------------------------------------------------------

insert into app_settings (key, value)
values ('owner_features_enabled', 'false'::jsonb)
on conflict (key) do nothing;
