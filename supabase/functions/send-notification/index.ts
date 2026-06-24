/**
 * Send push notifications via Expo Push Service.
 *
 * Called from Postgres (pg_net) after expense_splits insert, or manually for testing.
 * Auth: X-Notification-Webhook-Secret header must match NOTIFICATION_WEBHOOK_SECRET,
 * or Authorization Bearer service role key.
 *
 * Persists outcomes to notification_dispatches / notification_dispatch_recipients.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/supabase.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

type DispatchStatus = 'skipped' | 'sent' | 'partial' | 'error';
type RecipientStatus = 'skipped' | 'sent' | 'error';

export type NotificationEvent = 'expense_added';

interface SendRequest {
  event: NotificationEvent;
  actor_user_id: string;
  recipient_user_ids: string[];
  title: string;
  body: string;
  data: Record<string, unknown>;
  collapse_id?: string;
}

interface ExpoTicket {
  status: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface DispatchContext {
  event: string;
  entity_id: string | null;
  actor_user_id: string;
  title: string;
  body: string;
  collapse_id: string | null;
  payload_data: Record<string, unknown>;
  recipient_ids: string[];
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isAuthorized(req: Request): boolean {
  const webhookSecret = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET');
  if (webhookSecret) {
    return req.headers.get('X-Notification-Webhook-Secret') === webhookSecret;
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization');
  return Boolean(serviceKey && auth === `Bearer ${serviceKey}`);
}

function isSendingEnabled(): boolean {
  const flag = Deno.env.get('NOTIFICATIONS_ENABLED');
  if (flag === 'false' || flag === '0') return false;
  return true;
}

function getEntityId(payload: SendRequest): string | null {
  const params = payload.data?.params;
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const id = (params as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }

  if (payload.collapse_id?.includes(':')) {
    const part = payload.collapse_id.split(':').slice(1).join(':');
    return part || null;
  }

  return null;
}

function buildDispatchContext(payload: SendRequest, recipientIds: string[]): DispatchContext {
  return {
    event: payload.event,
    entity_id: getEntityId(payload),
    actor_user_id: payload.actor_user_id,
    title: payload.title,
    body: payload.body,
    collapse_id: payload.collapse_id ?? null,
    payload_data: payload.data ?? {},
    recipient_ids: recipientIds,
  };
}

async function recordDispatch(
  supabase: ReturnType<typeof getSupabaseClient>,
  ctx: DispatchContext,
  status: DispatchStatus,
  opts: {
    skip_reason?: string;
    sent_count?: number;
    ticket_count?: number;
    error_message?: string;
  } = {},
): Promise<string | null> {
  const { data, error } = await supabase
    .from('notification_dispatches')
    .insert({
      event: ctx.event,
      entity_id: ctx.entity_id,
      actor_user_id: ctx.actor_user_id,
      title: ctx.title,
      body: ctx.body,
      collapse_id: ctx.collapse_id,
      payload_data: ctx.payload_data,
      status,
      skip_reason: opts.skip_reason ?? null,
      recipient_ids: ctx.recipient_ids,
      sent_count: opts.sent_count ?? 0,
      ticket_count: opts.ticket_count ?? 0,
      error_message: opts.error_message ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[send-notification] Failed to record dispatch:', error.message);
    return null;
  }

  return data.id;
}

async function recordRecipients(
  supabase: ReturnType<typeof getSupabaseClient>,
  dispatchId: string | null,
  rows: {
    user_id: string | null;
    token: string | null;
    status: RecipientStatus;
    skip_reason?: string;
    expo_ticket_id?: string;
    error_message?: string;
  }[],
): Promise<void> {
  if (!dispatchId || rows.length === 0) return;

  const { error } = await supabase.from('notification_dispatch_recipients').insert(
    rows.map((r) => ({
      dispatch_id: dispatchId,
      user_id: r.user_id,
      token: r.token,
      status: r.status,
      skip_reason: r.skip_reason ?? null,
      expo_ticket_id: r.expo_ticket_id ?? null,
      error_message: r.error_message ?? null,
    })),
  );

  if (error) {
    console.error('[send-notification] Failed to record recipients:', error.message);
  }
}

async function finishSkipped(
  supabase: ReturnType<typeof getSupabaseClient>,
  ctx: DispatchContext,
  skip_reason: string,
  recipientRows: {
    user_id: string | null;
    token: string | null;
    status: RecipientStatus;
    skip_reason: string;
  }[] = [],
): Promise<Response> {
  const dispatchId = await recordDispatch(supabase, ctx, 'skipped', { skip_reason });
  await recordRecipients(supabase, dispatchId, recipientRows);
  return jsonResponse({ skipped: skip_reason, dispatch_id: dispatchId });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (!isSendingEnabled()) {
    return jsonResponse({ skipped: 'notifications_disabled' });
  }

  const supabase = getSupabaseClient();

  try {
    const payload = (await req.json()) as SendRequest;

    if (!payload.event || !payload.actor_user_id || !payload.title || !payload.body) {
      return jsonResponse({ error: 'Invalid payload' }, 400);
    }

    const allRecipientIds = payload.recipient_user_ids ?? [];
    const recipientIds = allRecipientIds.filter(
      (id) => id && id !== payload.actor_user_id,
    );
    const ctx = buildDispatchContext(payload, recipientIds);

    if (recipientIds.length === 0) {
      const skippedRows = allRecipientIds.map((id) => ({
        user_id: id,
        token: null,
        status: 'skipped' as RecipientStatus,
        skip_reason: id === payload.actor_user_id ? 'actor_excluded' : 'not_in_recipients',
      }));
      return await finishSkipped(supabase, ctx, 'no_recipients', skippedRows);
    }

    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, notifications_enabled')
      .in('id', recipientIds);

    if (usersErr) throw usersErr;

    const optedIn = (users ?? [])
      .filter((u) => u.notifications_enabled !== false)
      .map((u) => u.id);

    const optedOutIds = recipientIds.filter((id) => !optedIn.includes(id));

    if (optedIn.length === 0) {
      return await finishSkipped(
        supabase,
        ctx,
        'no_opted_in',
        recipientIds.map((id) => ({
          user_id: id,
          token: null,
          status: 'skipped' as RecipientStatus,
          skip_reason: 'notifications_disabled',
        })),
      );
    }

    const { data: tokens, error: tokensErr } = await supabase
      .from('user_push_tokens')
      .select('token, user_id')
      .in('user_id', optedIn);

    if (tokensErr) throw tokensErr;

    const tokenRows = tokens ?? [];
    const usersWithTokens = new Set(tokenRows.map((t) => t.user_id));
    const noTokenUserIds = optedIn.filter((id) => !usersWithTokens.has(id));

    if (tokenRows.length === 0) {
      return await finishSkipped(
        supabase,
        ctx,
        'no_tokens',
        recipientIds.map((id) => ({
          user_id: id,
          token: null,
          status: 'skipped' as RecipientStatus,
          skip_reason: optedOutIds.includes(id)
            ? 'notifications_disabled'
            : noTokenUserIds.includes(id)
              ? 'no_token'
              : 'actor_excluded',
        })),
      );
    }

    const messages = tokenRows.map((t) => ({
      to: t.token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      channelId: 'default',
      user_id: t.user_id,
      ...(payload.collapse_id ? { collapseId: payload.collapse_id } : {}),
    }));

    let sentCount = 0;
    let errorCount = 0;
    const tickets: ExpoTicket[] = [];
    const recipientLog: {
      user_id: string | null;
      token: string | null;
      status: RecipientStatus;
      skip_reason?: string;
      expo_ticket_id?: string;
      error_message?: string;
    }[] = [];

    for (const id of optedOutIds) {
      recipientLog.push({
        user_id: id,
        token: null,
        status: 'skipped',
        skip_reason: 'notifications_disabled',
      });
    }

    for (const id of noTokenUserIds) {
      recipientLog.push({
        user_id: id,
        token: null,
        status: 'skipped',
        skip_reason: 'no_token',
      });
    }

    for (let i = 0; i < messages.length; i += CHUNK) {
      const slice = messages.slice(i, i + CHUNK);
      const res = await fetchWithRetry(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          slice.map(({ to, sound, title, body, data, channelId, collapseId }) => ({
            to,
            sound,
            title,
            body,
            data,
            channelId,
            ...(collapseId ? { collapseId } : {}),
          })),
        ),
      });

      const json = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown[] };
      if (!res.ok) {
        console.error('[send-notification] Expo API error:', json);
        throw new Error(`Expo push API returned ${res.status}`);
      }

      const batchTickets = json.data ?? [];
      tickets.push(...batchTickets);

      slice.forEach((msg, index) => {
        const ticket = batchTickets[index];
        if (ticket?.status === 'ok') {
          sentCount += 1;
          recipientLog.push({
            user_id: msg.user_id,
            token: msg.to,
            status: 'sent',
            expo_ticket_id: ticket.id ?? null,
          });
        } else {
          errorCount += 1;
          recipientLog.push({
            user_id: msg.user_id,
            token: msg.to,
            status: 'error',
            error_message: ticket?.message ?? ticket?.details?.error ?? 'expo_error',
          });
        }
      });

      await handleTicketErrors(
        supabase,
        slice.map((m) => ({ to: m.to })),
        batchTickets,
      );
    }

    const dispatchStatus: DispatchStatus =
      errorCount > 0 && sentCount > 0 ? 'partial' : errorCount > 0 ? 'error' : 'sent';

    const dispatchId = await recordDispatch(supabase, ctx, dispatchStatus, {
      sent_count: sentCount,
      ticket_count: tickets.length,
    });
    await recordRecipients(supabase, dispatchId, recipientLog);

    return jsonResponse({
      event: payload.event,
      sent: sentCount,
      tickets: tickets.length,
      errors: errorCount,
      dispatch_id: dispatchId,
    });
  } catch (err) {
    console.error('[send-notification] error:', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempt = 0,
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) return res;
    await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    return fetchWithRetry(url, init, attempt + 1);
  }
  return res;
}

async function handleTicketErrors(
  supabase: ReturnType<typeof getSupabaseClient>,
  messages: { to: string }[],
  tickets: ExpoTicket[],
): Promise<void> {
  const staleTokens: string[] = [];

  tickets.forEach((ticket, index) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      staleTokens.push(messages[index]?.to);
    }
  });

  if (staleTokens.length === 0) return;

  const { error } = await supabase
    .from('user_push_tokens')
    .delete()
    .in('token', staleTokens.filter(Boolean));

  if (error) {
    console.error('[send-notification] Failed to remove stale tokens:', error.message);
  }
}
