DO $$ BEGIN
  PERFORM cron.unschedule('nightly-vacuum-analyze');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
    'nightly-vacuum-analyze',
    '0 20 * * *', -- 20:00 UTC = 04:00 Asia/Taipei
    $$VACUUM (ANALYZE)$$
);
