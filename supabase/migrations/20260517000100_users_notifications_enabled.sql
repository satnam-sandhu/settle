-- Per-user opt-in for push notifications (OS permission is separate).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.users.notifications_enabled IS 'When false, send-notification skips this user regardless of token rows.';
