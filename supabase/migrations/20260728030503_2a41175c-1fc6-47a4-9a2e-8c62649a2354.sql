select cron.schedule(
  'shopee-hourly-sync',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://project--2340221c-8701-4dfa-bbca-3ea03ca1e810.lovable.app/api/public/hooks/sync-shopee',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6ZWR1YWNrcXR0cnFiZ3FoaHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTMzNDYsImV4cCI6MjA5NzY4OTM0Nn0.N-dGb0JnhLb8ZUqjAUX72AVRoYN-lxFx_p_WE6UPCvE'
    ),
    body := '{}'::jsonb
  );
  $$
);