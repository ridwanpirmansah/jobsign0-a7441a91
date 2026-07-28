REVOKE SELECT ON public.shopee_settings FROM authenticated;

GRANT SELECT (
  id, shop_id, token_expires_at, connected_at, enabled, lookback_days,
  last_sync_at, last_sync_status, last_sync_message,
  last_sync_inserted, last_sync_updated, last_sync_skipped,
  created_at, updated_at
) ON public.shopee_settings TO authenticated;