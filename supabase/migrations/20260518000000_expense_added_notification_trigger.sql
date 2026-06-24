-- Phase 3: expense_added push notification trigger (pg_net → send-notification Edge Function)
--
-- PROD SETUP (run once in SQL Editor after deploying send-notification Edge Function):
--
-- 1. Create a random secret and store in Vault (pick a long random string):
--    SELECT vault.create_secret(
--      'YOUR_RANDOM_SECRET_HERE',
--      'notification_webhook_secret',
--      'Auth header for send-notification from DB triggers'
--    );
--
-- 2. Set the same value on the Edge Function:
--    supabase secrets set NOTIFICATION_WEBHOOK_SECRET=YOUR_RANDOM_SECRET_HERE
--    supabase secrets set NOTIFICATIONS_ENABLED=true
--    supabase functions deploy send-notification --no-verify-jwt
--
-- Optional: override functions URL (defaults to settle-prod project):
--    ALTER DATABASE postgres SET app.settings.supabase_functions_url
--      TO 'https://lxlxeotdanecurofzxzk.supabase.co/functions/v1/send-notification';

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_expense_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id UUID;
  v_expense RECORD;
  v_actor_name TEXT;
  v_recipient_ids UUID[];
  v_webhook_secret TEXT;
  v_functions_url TEXT;
  v_body TEXT;
  v_title TEXT;
BEGIN
  SELECT decrypted_secret INTO v_webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_secret'
  LIMIT 1;

  IF v_webhook_secret IS NULL THEN
    RAISE LOG 'notify_expense_added: vault secret notification_webhook_secret not configured — skipping push';
    RETURN NULL;
  END IF;

  v_functions_url := coalesce(
    nullif(current_setting('app.settings.supabase_functions_url', true), ''),
    'https://lxlxeotdanecurofzxzk.supabase.co/functions/v1/send-notification'
  );

  FOR v_expense_id IN
    SELECT DISTINCT expense_id FROM inserted_rows
  LOOP
    SELECT e.id, e.description, e.amount, e.currency, e.created_by
    INTO v_expense
    FROM public.expenses e
    WHERE e.id = v_expense_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT array_agg(DISTINCT es.user_id)
    INTO v_recipient_ids
    FROM public.expense_splits es
    WHERE es.expense_id = v_expense_id;

    IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT u.name INTO v_actor_name
    FROM public.users u
    WHERE u.id = v_expense.created_by;

    v_title := coalesce(v_actor_name, 'Someone') || ' added an expense';
    v_body := v_expense.description || ' · ' || v_expense.currency || ' ' || trim(to_char(v_expense.amount, '999,999,990.00'));

    PERFORM net.http_post(
      url := v_functions_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Notification-Webhook-Secret', v_webhook_secret
      ),
      body := jsonb_build_object(
        'event', 'expense_added',
        'actor_user_id', v_expense.created_by,
        'recipient_user_ids', to_jsonb(v_recipient_ids),
        'title', v_title,
        'body', v_body,
        'collapse_id', 'expense_added:' || v_expense_id::text,
        'data', jsonb_build_object(
          'event', 'expense_added',
          'route', '/expense/[id]',
          'params', jsonb_build_object('id', v_expense_id::text)
        )
      )
    );
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_expense_added ON public.expense_splits;

CREATE TRIGGER trg_notify_expense_added
  AFTER INSERT ON public.expense_splits
  REFERENCING NEW TABLE AS inserted_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.notify_expense_added();

COMMENT ON FUNCTION public.notify_expense_added IS
  'After expense_splits insert, POST to send-notification Edge Function for each distinct expense_id.';
