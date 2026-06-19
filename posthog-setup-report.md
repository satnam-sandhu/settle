<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Settle Expo app. The project already had a solid analytics foundation (`lib/analytics.ts`, `lib/analytics-events.ts`, `PostHogProvider` in `app/_layout.tsx`, and tracking across auth, expense, settlement, and group flows). The wizard filled in the remaining gaps — adding event tracking to four screens that had none — and ensured environment variables point to the correct US PostHog host.

**Summary of changes:**

- **`.env`** — Updated `EXPO_PUBLIC_POSTHOG_API_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` to correct production values (`https://us.i.posthog.com`).
- **`lib/analytics.ts`** — Fixed fallback host from `eu.i.posthog.com` → `us.i.posthog.com`.
- **`app/(auth)/forgot-password.tsx`** — Added `forgot_password_started` on mount and `forgot_password_otp_requested` on successful OTP send.
- **`app/expense/[id].tsx`** — Added `expense_viewed` when expense data loads, `expense_edited` when user taps the edit pencil, and `expense_deleted` after a successful delete.
- **`app/group/[id]/index.tsx`** — Added `group_viewed` on mount with `group_id` property.
- **`app/friend/[id].tsx`** — Added `friend_viewed` on mount with `friend_id` property.

| Event | Description | File |
|---|---|---|
| `forgot_password_started` | User opens the forgot password screen | `app/(auth)/forgot-password.tsx` |
| `forgot_password_otp_requested` | User successfully requests an OTP for password reset | `app/(auth)/forgot-password.tsx` |
| `expense_viewed` | User views the detail screen for a specific expense | `app/expense/[id].tsx` |
| `expense_edited` | User taps the edit button on an expense detail screen | `app/expense/[id].tsx` |
| `expense_deleted` | User successfully deletes an expense from the detail screen | `app/expense/[id].tsx` |
| `group_viewed` | User opens a group detail screen | `app/group/[id]/index.tsx` |
| `friend_viewed` | User opens a friend detail screen | `app/friend/[id].tsx` |

**Previously instrumented events (existing coverage):**

`sign_up_started`, `sign_up_otp_requested`, `sign_up_otp_verified`, `sign_up_password_set`, `sign_up_completed`, `sign_up_failed`, `sign_in_started`, `sign_in_completed`, `sign_in_failed`, `sign_out`, `add_expense_started`, `add_expense_completed`, `add_expense_failed`, `settle_up_started`, `settle_up_friend_selected`, `settle_up_completed`, `settle_up_failed`, `create_group_started`, `create_group_completed`, `create_group_failed`, `tab_home_viewed`, `tab_groups_viewed`, `tab_friends_viewed`, `tab_profile_viewed`

## Next steps

We've built a dashboard and five insights for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1617916)
- [Signup Conversion Funnel](/insights/kBOWkoo7) — Drop-off from signup start → OTP verified → signup completed
- [Daily Active Users](/insights/lRmklOWN) — Unique users active per day over the last 30 days
- [Core Actions Trend](/insights/Psj3a8QL) — Expenses added, settlements, and groups created side by side
- [Sign-in Success vs Failure](/insights/oFqY4lUe) — Monitor authentication health and failure rate
- [Expense Engagement](/insights/jXWe6xV8) — Expense views, edits, and deletions to measure user interaction depth

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
