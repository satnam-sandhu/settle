-- Per-device Expo push tokens (one user, many devices).
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    app_version     TEXT,
    device_name     TEXT,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON public.user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_last_seen ON public.user_push_tokens(last_seen_at DESC);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own push tokens"
  ON public.user_push_tokens
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.user_push_tokens IS 'Expo push tokens per device; read by send-notification Edge Function via service role.';
