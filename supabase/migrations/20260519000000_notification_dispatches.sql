-- Audit log for push notification delivery (debugging + ops visibility).
-- Written by send-notification Edge Function (service role).

CREATE TABLE IF NOT EXISTS public.notification_dispatches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event           TEXT NOT NULL,
    entity_id       UUID,
    actor_user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    collapse_id     TEXT,
    payload_data    JSONB,
    status          TEXT NOT NULL CHECK (status IN ('skipped', 'sent', 'partial', 'error')),
    skip_reason     TEXT,
    recipient_ids   UUID[],
    sent_count      INT NOT NULL DEFAULT 0,
    ticket_count    INT NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_created
  ON public.notification_dispatches(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_event_entity
  ON public.notification_dispatches(event, entity_id);

CREATE TABLE IF NOT EXISTS public.notification_dispatch_recipients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id     UUID NOT NULL REFERENCES public.notification_dispatches(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
    token           TEXT,
    status          TEXT NOT NULL CHECK (status IN ('skipped', 'sent', 'error')),
    skip_reason     TEXT,
    expo_ticket_id  TEXT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_recipients_dispatch
  ON public.notification_dispatch_recipients(dispatch_id);

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_recipients_user
  ON public.notification_dispatch_recipients(user_id, created_at DESC);

ALTER TABLE public.notification_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dispatch_recipients ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.notification_dispatches IS
  'One row per send-notification invocation; status/skip_reason explain delivery outcome.';
COMMENT ON TABLE public.notification_dispatch_recipients IS
  'Per-user/token outcome for a dispatch (skipped, sent, or Expo error).';

-- Reassign push token to current user when same device logs in as a different account
-- (avoids RLS blocking upsert on token owned by another user_id).
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token TEXT,
  p_platform TEXT,
  p_app_version TEXT DEFAULT NULL,
  p_device_name TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Invalid platform';
  END IF;

  DELETE FROM public.user_push_tokens WHERE token = p_token;

  INSERT INTO public.user_push_tokens (
    user_id, token, platform, app_version, device_name, last_seen_at
  )
  VALUES (
    auth.uid(), p_token, p_platform, p_app_version, p_device_name, NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.register_push_token IS
  'Upsert Expo push token for the signed-in user; removes prior owner of the same device token.';

GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT, TEXT, TEXT) TO authenticated;
