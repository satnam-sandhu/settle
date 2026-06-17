# Push Notifications — Implementation Plan

Senior architecture plan for adding push notifications to **Settle** using **Expo Notifications** (client) and **Supabase** (backend), based on the official Expo documentation.

Status: **Phase 3 code complete** — deploy Edge Function + apply trigger SQL on prod, then run [Consolidated push QA](#consolidated-push-qa-deferred).

---

## Phase 0 — Locked decisions (2026-05-17)

| Decision | Outcome |
|----------|---------|
| **v1 events** | `expense_added`, `expense_edited`, `expense_deleted`, `settlement_added`, `settlement_deleted`, `group_member_added` |
| **Trigger source** | **Postgres trigger + `pg_net`** → `send-notification` Edge Function (covers RPC, direct inserts, offline sync replay) |
| **Transport** | Expo Push Service (`https://exp.host/--/api/v2/push/send`) |
| **Notification icon** | `assets/images/notification-icon.png` (copied from `android-icon-monochrome.png`; 96×96 monochrome for Android status bar) |
| **EAS / credentials** | Single EAS project (`dd43d452-f7f8-4996-8d1b-64f597f89014`); APNs + FCM v1 via EAS Build credentials. **Development** profile for push QA; **production** for store. Kill-switch: `EXPO_PUBLIC_NOTIFICATIONS_ENABLED=false` locally so dev builds do not spam production users. Revisit a separate Expo dev project only if test traffic pollutes prod analytics/push. |
| **Expo Go** | **Not supported** for remote push (SDK 53+). Use `eas build --profile development` and install the dev client. |
| **Per-user opt-in** | One global toggle in Profile (v1); maps to `users.notifications_enabled` + OS permission. Per-event toggles deferred. |
| **Group mute** | Deferred (would need `group_members.notifications_muted`). |

---

## 1. Goals & Non-Goals

### Goals (v1)

- Reliable, opt-in push notifications on iOS and Android.
- Notify users on high-signal events: **expense added**, **settlement recorded**, **added to a group**, plus **edits/deletes** of those.
- Server-driven: never trust the client to decide who to notify.
- Respect per-user opt-out and OS-level permission state.
- Tap a notification → deep link into the relevant screen.
- Multi-device per user.
- Graceful failure handling (retries, cleanup of stale tokens).

### Non-Goals (v1)

- Marketing / digest notifications.
- Scheduled "you owe X" reminders.
- Rich notifications (images, action buttons).
- In-app inbox / notification history.
- Web push.

These can be layered on after v1 ships.

---

## 2. Source of Truth

All decisions in this doc are grounded in the official Expo documentation:

- [Push notifications: Overview](https://docs.expo.dev/push-notifications/overview/)
- [Push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Send notifications with the Expo Push Service](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Handle incoming notifications](https://docs.expo.dev/push-notifications/receiving-notifications/)
- [What you need to know about notifications](https://docs.expo.dev/push-notifications/what-you-need-to-know/)
- [Send notifications with FCM and APNs](https://docs.expo.dev/push-notifications/sending-notifications-custom/) (fallback path, not used in v1)
- [`expo-notifications` SDK reference](https://docs.expo.dev/versions/latest/sdk/notifications/)

---

## 3. Architecture Overview

```text
                         ┌─────────────────────────┐
                         │  React Native (Settle)  │
                         │   expo-notifications    │
                         └─────────────┬───────────┘
                                       │ 1. permission + getExpoPushTokenAsync
                                       │ 2. upsert into user_push_tokens (RLS)
                                       ▼
                         ┌─────────────────────────┐
                         │  Supabase Postgres      │
                         │   - user_push_tokens    │
                         │   - users / groups /    │
                         │     expenses /          │
                         │     settlements         │
                         └─────────────┬───────────┘
                                       │ 3. INSERT/UPDATE/DELETE on
                                       │    expenses / settlements /
                                       │    group_members
                                       ▼
                         ┌─────────────────────────┐
                         │  Trigger / Webhook /    │
                         │  RPC call               │
                         └─────────────┬───────────┘
                                       │ 4. invoke Edge Function
                                       ▼
                         ┌─────────────────────────┐
                         │  Edge Function          │
                         │  send-notification      │
                         │   - resolve recipients  │
                         │   - check opt-in        │
                         │   - chunk to 100        │
                         │   - POST Expo Push API  │
                         │   - store ticket ids    │
                         │   - cleanup bad tokens  │
                         └─────────────┬───────────┘
                                       │ 5. HTTPS
                                       ▼
                         ┌─────────────────────────┐
                         │  Expo Push Service      │
                         │  → APNs / FCM v1        │
                         └─────────────┬───────────┘
                                       ▼
                         ┌─────────────────────────┐
                         │   User devices          │
                         │   tap → deep link       │
                         └─────────────────────────┘
```

**Realtime stays as-is.** `hooks/use-realtime-sync.ts` keeps invalidating React Query caches when the app is in the foreground. Push notifications are for **background / killed** state.

---

## 4. Stack Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Client library | `expo-notifications` + `expo-constants` + `expo-device` | Official, matches Expo SDK 54, handles APNs/FCM differences |
| Transport | **Expo Push Service** (`https://exp.host/--/api/v2/push/send`) | EAS provisions APNs/FCM credentials; one HTTP API |
| Server runtime | Supabase Edge Functions (Deno) | Same pattern as existing `send-otp`, `verify-otp`, `create-account` |
| Trigger source | Documented all 3 — recommendation in §6.4 | Picked during Phase 3 with team |
| Token storage | New table `public.user_push_tokens` | Multi-device, per-platform, per-token metadata |
| Per-user opt-in | DB column on `users` (`notifications_enabled`) | Currently only AsyncStorage in app — must move server-side |
| Build flavor | EAS dev/preview/production builds | Push does **not** work in Expo Go on SDK 53+ |
| Dev kill-switch | `EXPO_PUBLIC_NOTIFICATIONS_ENABLED` env flag | Mirrors the analytics flag pattern just implemented |

---

## 5. Frontend Implementation (React Native + Expo)

### 5.1 Packages & `app.json`

Install:

```sh
npx expo install expo-notifications expo-constants expo-device
```

`app.json` plugin entry (alongside existing plugins):

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      ["expo-splash-screen", { "...": "..." }],
      ["expo-image-picker", { "...": "..." }],
      "expo-localization",
      [
        "expo-notifications",
        {
          "icon": "./assets/images/notification-icon.png",
          "color": "#4CAF50",
          "defaultChannel": "default"
        }
      ]
    ]
  }
}
```

`expo-notifications` plugin auto-adds the iOS APNs entitlement (`aps-environment`) — no manual entitlement edit needed (Expo: APNs entitlement guidance).

EAS already has `extra.eas.projectId = dd43d452-f7f8-4996-8d1b-64f597f89014` — required by `getExpoPushTokenAsync({ projectId })`.

### 5.2 Folder layout

```
lib/
├── notifications.ts            # core: setup, permissions, token, listeners
└── notification-events.ts      # event-name + payload-shape constants

hooks/
└── use-push-notifications.ts   # registers listeners, returns token + status

contexts/
└── (existing settings-context.tsx — extended for server-side opt-in)
```

### 5.3 Permission lifecycle

Per Expo guidance:

- iOS: explicit `requestPermissionsAsync()` call → OS dialog.
- Android 13+: `POST_NOTIFICATIONS` runtime permission via the same call.
- **Ask only when the user opts in via the Profile toggle** (better UX, better grant rate). Do **not** request on first launch.
- Always read `getPermissionsAsync()` before requesting.
- If permission denied → show explainer; offer deep-link to OS settings (`Linking.openSettings()`).

### 5.4 Token registration

```ts
// lib/notifications.ts (sketch)
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushAsync() {
  if (!Device.isDevice) return null; // simulators can't receive push

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#4CAF50',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== 'granted') return null;

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId;
  if (!projectId) throw new Error('Missing EAS projectId');

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await persistToken(token);
  return token;
}

async function persistToken(token: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('user_push_tokens').upsert(
    {
      user_id: user.id,
      token,
      platform: Platform.OS,
      app_version: Constants.expoConfig?.version,
      device_name: Device.deviceName,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );
}
```

Notes:

- `getExpoPushTokenAsync` returns the same token across reinstalls on the same device only when EAS `projectId` is stable — which it is for us.
- Re-register on each cold start (token can rotate); the `upsert` keeps the row fresh via `last_seen_at`.
- **Multi-device:** primary key on `token`, not `user_id`. One user can have many rows.

### 5.5 Foreground handler + listeners

```ts
// hooks/use-push-notifications.ts (sketch)
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

export function usePushNotifications() {
  const router = useRouter();

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => {
      // optional: bump unread badge / log via analytics
    });

    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { route?: string; params?: Record<string, string> }
        | undefined;
      if (data?.route) {
        router.push({ pathname: data.route as never, params: data.params } as never);
      }
    });

    return () => {
      received.remove();
      responded.remove();
    };
  }, [router]);
}
```

Mount `usePushNotifications()` in `app/_layout.tsx` inside the existing provider tree (after `AuthProvider`, so the user is known).

### 5.6 Deep-link mapping (drives the `data.route` payload)

| Event | Route | Params |
|-------|-------|--------|
| Expense added | `/expense/[id]` | `{ id }` |
| Expense edited | `/expense/[id]` | `{ id }` |
| Expense deleted | `/group/[id]` (parent group) or `/friends` (1:1) | depends on context |
| Settlement recorded | `/friend/[id]` | `{ id: counterparty_user_id }` |
| Settlement deleted | `/friend/[id]` | `{ id }` |
| Added to group | `/group/[id]` | `{ id: group_id }` |

These match existing routes in `app/`. Worst case (route missing on cold start) → `expo-router` resolves once the auth gate clears.

### 5.7 Profile toggle — lift from local-only to server-aware

Today: `contexts/settings-context.tsx` stores `notificationsEnabled` in AsyncStorage only; the toggle UI in `app/(tabs)/profile.tsx` is commented out.

New behavior:

- **On** → request OS permission → register Expo token → set `users.notifications_enabled = true`.
- **Off** → set `users.notifications_enabled = false` and **delete** this device's token row.
- AsyncStorage stays as the local fast-path mirror.
- Show the OS permission state separately ("Notifications permission denied — Open settings").

### 5.8 Sign-out cleanup

In `contexts/auth-context.tsx`:

- Before calling `supabase.auth.signOut()`, delete the current device's row from `user_push_tokens`.
- Reason: prevents the next user on the same device from receiving the previous user's pushes.

### 5.9 Edge cases

- **Expo Go on SDK 53+:** push notifications were removed. Development must use an EAS dev build. Document this in `README.md`.
- **iOS Simulator:** can receive local notifications, but for **remote** push must be Xcode 14+ on macOS 13+ (simulator push is supported; physical device still preferred).
- **Android emulator:** must have Google Play services.
- **Permission revoked between sessions:** check `getPermissionsAsync()` on app foreground; if revoked, mark token row inactive.

---

## 6. Backend Implementation (Supabase)

### 6.1 Migration: `user_push_tokens`

File: `supabase/migrations/20260517000000_user_push_tokens.sql`

```sql
-- Per-device push tokens. One user, many rows (one per device/install).
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    app_version     TEXT,
    device_name     TEXT,
    last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_push_tokens_user_id ON public.user_push_tokens(user_id);
CREATE INDEX idx_user_push_tokens_last_seen ON public.user_push_tokens(last_seen_at DESC);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own push tokens"
  ON public.user_push_tokens
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Service role (used by Edge Function) bypasses RLS — it can read tokens for any recipient.

### 6.2 Migration: `users.notifications_enabled`

File: `supabase/migrations/20260517000100_users_notifications_enabled.sql`

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Index isn't strictly needed; recipient set is small per event.
```

Default `TRUE` so existing users opt in by default; the OS-level permission gate is the real consent point.

### 6.3 Edge Function: `send-notification`

File: `supabase/functions/send-notification/index.ts`

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/supabase.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

type NotificationEvent =
  | 'expense_added'
  | 'expense_edited'
  | 'expense_deleted'
  | 'settlement_added'
  | 'settlement_deleted'
  | 'group_member_added';

interface SendRequest {
  event: NotificationEvent;
  actor_user_id: string;        // who triggered it; must be excluded
  recipient_user_ids: string[]; // resolved recipients
  title: string;
  body: string;
  data: Record<string, unknown>; // includes route + params for deep link
  collapse_id?: string;          // dedupe in Expo's queue
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = (await req.json()) as SendRequest;
    const supabase = getSupabaseClient();

    const recipientIds = payload.recipient_user_ids.filter(
      (id) => id !== payload.actor_user_id,
    );
    if (recipientIds.length === 0) return ok({ skipped: 'no_recipients' });

    // Filter by per-user opt-in
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, notifications_enabled')
      .in('id', recipientIds);
    if (usersErr) throw usersErr;
    const optedIn = (users ?? [])
      .filter((u) => u.notifications_enabled)
      .map((u) => u.id);
    if (optedIn.length === 0) return ok({ skipped: 'no_opted_in' });

    // Load tokens
    const { data: tokens, error: tokensErr } = await supabase
      .from('user_push_tokens')
      .select('token, user_id')
      .in('user_id', optedIn);
    if (tokensErr) throw tokensErr;
    if (!tokens?.length) return ok({ skipped: 'no_tokens' });

    // Build messages
    const messages = tokens.map((t) => ({
      to: t.token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      ...(payload.collapse_id ? { collapseId: payload.collapse_id } : {}),
    }));

    // Send in chunks of 100 (Expo limit)
    const tickets: unknown[] = [];
    for (let i = 0; i < messages.length; i += CHUNK) {
      const slice = messages.slice(i, i + CHUNK);
      const res = await fetchWithRetry(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
          'content-type': 'application/json',
        },
        body: JSON.stringify(slice),
      });
      const json = await res.json();
      tickets.push(...(json.data ?? []));
      await handleTicketErrors(supabase, slice, json.data ?? []);
    }

    return ok({ sent: tokens.length, tickets: tickets.length });
  } catch (err) {
    console.error('[send-notification] error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchWithRetry(url: string, init: RequestInit, attempt = 0): Promise<Response> {
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
  tickets: { status: string; details?: { error?: string } }[],
) {
  const stale: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
      stale.push(messages[i].to);
    }
  });
  if (stale.length) {
    await supabase.from('user_push_tokens').delete().in('token', stale);
  }
}
```

Deploy via existing script:

```sh
npm run functions:deploy
```

Existing `package.json` deploys with `--no-verify-jwt`. For `send-notification` we likely want **JWT verification enabled** (only authenticated callers / triggers) — adjust the deploy command for this function specifically:

```sh
supabase functions deploy send-notification
```

(without `--no-verify-jwt`).

### 6.4 Triggering the Edge Function — three options

We picked **"document all three; decide in Phase 3"**. Recommendation per option:

#### A) Postgres trigger + `pg_net` → Edge Function

Pros: fires for every insert path (direct `INSERT`, RPC, future scripts). Most reliable.

Cons: Requires `pg_net` extension; debugging happens in DB logs.

```sql
-- Enable once
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Example trigger after expense insert
CREATE OR REPLACE FUNCTION notify_expense_added()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  recipient_ids UUID[];
BEGIN
  SELECT array_agg(user_id) INTO recipient_ids
  FROM public.expense_splits WHERE expense_id = NEW.id;

  PERFORM net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := jsonb_build_object(
      'event', 'expense_added',
      'actor_user_id', NEW.created_by,
      'recipient_user_ids', recipient_ids,
      'title', 'New expense',
      'body', NEW.description,
      'data', jsonb_build_object('route', '/expense/[id]', 'params', jsonb_build_object('id', NEW.id::text)),
      'collapse_id', 'expense_added:' || NEW.id::text
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_expense_added
AFTER INSERT ON public.expenses
FOR EACH ROW EXECUTE FUNCTION notify_expense_added();
```

Same shape for `settlements`, `group_members`, plus UPDATE/DELETE triggers for edits/deletes.

#### B) Supabase Database Webhook → Edge Function

Pros: managed in dashboard, no SQL migration for the wiring.

Cons: dashboard config drifts from repo; harder to review.

#### C) Edge Function call from app after success

Pros: simplest, fully in TypeScript.

Cons: must also fire from `lib/sync-manager.ts` when offline queue replays. **Easy to miss inserts** that aren't routed through it.

#### Recommendation

**Option A (Postgres trigger + `pg_net`)** for v1, because:

- All insert paths are covered (RPC `create_grouped_expense`, direct inserts, sync-queue replays).
- Triggers are versioned in `supabase/migrations/` — same review process as schema.
- Edits/deletes can use the same machinery.

Fallback to B if `pg_net` setup is friction; never A+C together (double-send).

### 6.5 Idempotency / dedupe

- **`collapse_id` on Expo messages** keeps duplicates collapsed in the queue (e.g. trigger retries).
- **Server-side dedupe table** (optional):

```sql
CREATE TABLE IF NOT EXISTS public.notification_dispatches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event         TEXT NOT NULL,
    entity_id     UUID NOT NULL,
    sent_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (event, entity_id)
);
```

Edge Function checks/inserts before sending. Only needed if we observe duplicates in practice.

### 6.6 Push receipts

Per Expo docs: ~15 minutes after sending, fetch receipts at `https://exp.host/--/api/v2/push/getReceipts` to detect downstream FCM/APNs failures.

For v1 we can skip a separate receipt-checker and rely on `DeviceNotRegistered` cleanup happening organically as new pushes are sent. Add a scheduled function later if delivery quality issues arise.

### 6.7 Secrets & configuration

Set as Supabase function secrets (not in repo):

```sh
supabase secrets set EXPO_ACCESS_TOKEN=...      # only needed if we enable enhanced security
supabase secrets set NOTIFICATIONS_ENABLED=true # server-side kill switch
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already available to Edge Functions.

> Expo "enhanced security" (recommended): generate an Expo access token for the project and set the `Authorization: Bearer <token>` header on push send. Optional in v1 since the push API is open by default; turn on once stable.

---

## 7. Event Catalogue (v1)

For each event: trigger, recipient resolution, exclusions, payload, deep link.

### 7.1 `expense_added`

- **Trigger:** `AFTER INSERT ON expense_splits` (statement-level; fires when splits are saved so recipients exist)
- **Recipients:** all `user_id` in `expense_splits` where `expense_id = NEW.id`
- **Exclude:** `NEW.created_by`
- **Title:** `"<Actor name> added an expense"`
- **Body:** `"<description> · <currency> <amount>"`
- **Data:** `{ route: '/expense/[id]', params: { id } }`
- **collapse_id:** `expense_added:<expense_id>`

### 7.2 `expense_edited`

- **Trigger:** `AFTER UPDATE ON expenses` (only when material fields change: amount / split / description)
- **Recipients:** union of old and new split user_ids
- **Exclude:** `NEW.created_by`
- **Title:** `"<Actor> updated an expense"`
- **collapse_id:** `expense_edited:<expense_id>`

### 7.3 `expense_deleted`

- **Trigger:** `AFTER DELETE ON expenses`
- **Recipients:** old split user_ids
- **Exclude:** the deleter (use `auth.uid()` captured in trigger context, or pass through a stored procedure)
- **Body:** `"<Actor> deleted '<description>'"`
- **Deep link:** parent group screen

### 7.4 `settlement_added`

- **Trigger:** `AFTER INSERT ON settlements`
- **Recipients:** `[NEW.paid_to]`
- **Exclude:** `NEW.paid_by`
- **Title:** `"<Actor> paid you"`
- **Body:** `"<currency> <amount>"`
- **Deep link:** `/friend/<paid_by>`

### 7.5 `settlement_deleted`

- **Trigger:** `AFTER DELETE ON settlements`
- **Recipients:** `[OLD.paid_to]`
- **Exclude:** the deleter

### 7.6 `group_member_added`

- **Trigger:** `AFTER INSERT ON group_members`
- **Recipients:** `[NEW.user_id]`
- **Exclude:** none (the new member is the recipient)
- **Title:** `"You were added to <group_name>"`
- **Deep link:** `/group/<group_id>`

### 7.7 Shadow users

Shadow users (`is_registered = false`) have **no auth.user**, no token. They never receive push and are filtered out by the join `user_push_tokens.user_id`. No special code needed.

---

## 8. Testing Plan

| Scenario | How to test |
|----------|-------------|
| Permission grant flow | Toggle in Profile → grants OS permission → token row appears in DB |
| Permission deny flow | Deny → toggle reverts → no token written |
| Foreground notification | Expo push tool → banner appears via `setNotificationHandler` |
| Background notification | Expo push tool → notification in tray → tap deep-links to expected route |
| Killed-app notification | Force-quit app → send → tap → app cold-starts → routes correctly after auth |
| Multi-device | Sign in on two devices → both receive |
| Sign-out cleanup | Sign out on device A → expense added → only device B receives |
| Opt-out (`users.notifications_enabled = false`) | Edge Function skips this user |
| `DeviceNotRegistered` cleanup | Uninstall + send → after retry, stale token row deleted |
| Edits / deletes | All 6 events fire end-to-end |
| Self-action exclusion | Actor never receives their own action's push |
| iOS Simulator | Local notifications work; remote push only on device or Xcode 14+ simulator |

EAS profile to build for testing: `development` (already configured in `eas.json`).

---

## 9. Rollout & Kill-Switches

- `EXPO_PUBLIC_NOTIFICATIONS_ENABLED=false` in client `.env` → skips `registerForPushAsync` and listener mounting (mirrors the analytics flag we just added).
- `NOTIFICATIONS_ENABLED=false` Supabase secret → Edge Function early-returns; pairs with the `users.notifications_enabled` per-user opt-out.
- Use a separate **dev EAS project / Expo project** for development if production users start seeing test pushes.

---

## 10. Phased Implementation Plan (Trackable)

> Tick each box as it lands. Owner column to be filled when assigned.

### Phase 0 — Decisions & Prep

- [x] Confirm v1 event list (expense add/edit/delete, settlement add/delete, group member added)
- [x] Confirm trigger source: Postgres trigger + `pg_net` (recommended)
- [x] Confirm icon asset for notifications (`assets/images/notification-icon.png`)
- [x] Confirm separate dev / prod EAS push credentials strategy
- [ ] Update `README.md` to note "push requires EAS dev build, not Expo Go" *(deferred — document in plan only until release)*

### Phase 1 — Client foundation (no sending yet)

- [x] `npx expo install expo-notifications expo-constants expo-device`
- [x] Add `expo-notifications` plugin to `app.json` with icon + color
- [x] Create `lib/notifications.ts` with `setNotificationHandler`, `registerForPushAsync`, `persistToken`
- [x] Create `hooks/use-push-notifications.ts` (received + response listeners)
- [x] Mount `usePushNotifications()` in `app/_layout.tsx` (inside `AuthProvider`)
- [x] Add `EXPO_PUBLIC_NOTIFICATIONS_ENABLED` flag (off by default in dev `.env`, on in `.env.example`)
- [ ] ~~EAS dev build + verify token~~ → **deferred** to [Consolidated push QA](#consolidated-push-qa-deferred) (test with Phase 2 + 3 together)

### Phase 2 — Backend foundation

- [x] Migration: `user_push_tokens` table + RLS (`20260517000000_user_push_tokens.sql`)
- [x] Migration: `users.notifications_enabled` column (`20260517000100_users_notifications_enabled.sql`)
- [x] Prod schema applied via SQL Editor (`user_push_tokens`, `notifications_enabled`, RLS policy)
- [ ] ~~Verify client upsert~~ → **deferred** to [Consolidated push QA](#consolidated-push-qa-deferred)
- [x] Types updated: `types/database.ts`, `types/supabase.ts` (`DbUserPushToken`, `notifications_enabled`)

### Phase 3 — Sending pipeline

- [x] Pick trigger source: **pg_net + Postgres trigger** (decided in Phase 0)
- [x] Edge Function `send-notification` (`supabase/functions/send-notification/`)
- [x] Webhook secret auth (`NOTIFICATION_WEBHOOK_SECRET` + Vault `notification_webhook_secret`)
- [x] Recipients filter: opt-in + exclude actor + DeviceNotRegistered cleanup
- [x] First trigger: `expense_added` on `expense_splits` insert (`20260518000000_expense_added_notification_trigger.sql`)
- [ ] Deploy function + apply trigger SQL on prod *(manual — see setup below)*
- [ ] ~~End-to-end test on device~~ → **deferred** to [Consolidated push QA](#consolidated-push-qa-deferred)

#### Phase 3 prod setup (manual)

1. Generate a random secret (e.g. `openssl rand -hex 32`)
2. **Vault** (SQL Editor):
   ```sql
   SELECT vault.create_secret(
     'YOUR_SECRET',
     'notification_webhook_secret',
     'Auth for send-notification from DB triggers'
   );
   ```
3. **Edge Function secrets + deploy** (terminal with Supabase access):
   ```bash
   supabase secrets set NOTIFICATION_WEBHOOK_SECRET=YOUR_SECRET
   supabase secrets set NOTIFICATIONS_ENABLED=true
   npm run functions:deploy:notification
   ```
4. **Trigger migration** — run `supabase/migrations/20260518000000_expense_added_notification_trigger.sql` in SQL Editor on settle-prod

### Consolidated push QA (deferred)

Test **once** after Phase 3 (minimum: `expense_added` trigger) on a **physical Android device** with an **EAS development build** — not Expo Go.

**Prep**

- [ ] `eas build --profile development --platform android` → install APK
- [ ] `.env`: `EXPO_PUBLIC_NOTIFICATIONS_ENABLED=true` → restart Metro
- [ ] FCM credentials configured in EAS (Android push)

**Phase 1 checks**

- [ ] Sign in → OS notification permission prompt appears
- [ ] Metro log: `[Notifications] Expo push token registered`
- [ ] Supabase Table Editor: row in `user_push_tokens` for your user

**Phase 2 checks**

- [ ] Token row has correct `platform`, `user_id`, `token` (ExponentPushToken[…])

**Phase 3 checks**

- [ ] Second user/device: add expense including first user → push received
- [ ] Tap notification → opens correct screen (deep link)
- [ ] Optional: [expo.dev/notifications](https://expo.dev/notifications) manual send with stored token

**After QA**

- [ ] Set `EXPO_PUBLIC_NOTIFICATIONS_ENABLED=false` locally if not actively testing
- [ ] Tick Phase 1 / Phase 2 deferred items above

### Phase 4 — Event coverage

- [ ] Trigger: `expense_edited` (filter by material field changes)
- [ ] Trigger: `expense_deleted`
- [ ] Trigger: `settlement_added`
- [ ] Trigger: `settlement_deleted`
- [ ] Trigger: `group_member_added`
- [ ] Verify all deep links route correctly from background and killed states

### Phase 5 — Profile UI + opt-in lifecycle

- [ ] Un-comment Notifications toggle in `app/(tabs)/profile.tsx`
- [ ] Wire toggle to OS permission + token register/delete + `users.notifications_enabled` update
- [ ] Sign-out cleanup: delete current device's token row in `contexts/auth-context.tsx`
- [ ] Foreground re-check: revoke permission outside app → next foreground marks token inactive

### Phase 6 — Hardening

- [ ] Add `collapse_id` per event
- [ ] Add `notification_dispatches` table + dedupe (only if duplicates seen)
- [ ] Receipt checker (scheduled function) — optional
- [ ] Enable Expo enhanced security with access token
- [ ] Analytics events: `notification_received`, `notification_opened`, `notification_permission_granted/denied` (already have `Analytics` wrapper; add to `lib/analytics-events.ts`)

### Phase 7 — Release

- [ ] EAS preview build → internal testing
- [ ] QA matrix from §8 ✅ on iOS + Android
- [ ] Update `CHANGELOG.md`
- [ ] Production EAS build + submit
- [ ] Set `EXPO_PUBLIC_NOTIFICATIONS_ENABLED=true` in production env / EAS secrets

---

## 11. Open Questions

- Do we want a per-event opt-in (later), or one global toggle (v1)?
- Do we mute notifications for users who silenced a specific group? (would need `group_members.notifications_muted`)
- Quiet hours respected by Expo? (No — handled per-OS by user; we don't override)
- Should "added to a group" notification include who added them? (Probably yes — improves trust)

---

## 12. Appendix

### 12.1 Push payload reference

```json
{
  "to": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "sound": "default",
  "title": "Rahul added an expense",
  "body": "Dinner · INR 1,200",
  "data": {
    "event": "expense_added",
    "route": "/expense/[id]",
    "params": { "id": "<expense_uuid>" }
  },
  "collapseId": "expense_added:<expense_uuid>",
  "priority": "default",
  "channelId": "default"
}
```

### 12.2 Error catalogue (Expo Push Service)

| Error | Action |
|-------|--------|
| `DeviceNotRegistered` | Delete token from `user_push_tokens` |
| `InvalidCredentials` | Re-check EAS APNs/FCM credentials |
| `MessageTooBig` | Trim body (limit ~4 KB) |
| `MessageRateExceeded` | Backoff; chunk size already 100 |
| `MismatchSenderId` | Android FCM project mismatch — fix in EAS credentials |

### 12.3 References

- Expo SDK 54 docs — see §2.
- Existing in-repo patterns:
  - Edge Functions: `supabase/functions/_shared/`, `send-otp/`, `verify-otp/`
  - Migrations: `supabase/migrations/`
  - Realtime sync: `hooks/use-realtime-sync.ts`
  - Settings stub: `contexts/settings-context.tsx`, `lib/storage.ts` (`NOTIFICATIONS_ENABLED`)
- Project IDs:
  - Supabase: `lxlxeotdanecurofzxzk`
  - EAS: `dd43d452-f7f8-4996-8d1b-64f597f89014`
  - iOS bundle: `com.satnamsandhu.settle`
  - Android package: `com.satnamsandhu.settle`
