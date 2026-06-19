# Home & Navigation Redesign — Implementation Plan

**Status:** Ready to implement  
**Last updated:** 15 Jun 2026  
**Related:** `docs/UI_UX_UPGRADE_PLAN.md` (general polish), `components/people-search-sheet.tsx`, `components/ui/frosted-surface.tsx`

---

## Goal

Shift Settle from a **dashboard with buttons** to a **glanceable money view** with one primary global action (`+`) and contextual actions embedded in the summary card.

### Core philosophy

> The Home screen should stop being a place where users choose what to do. It should become a place where users understand their money at a glance.

### Target navigation

| Before | After |
|--------|-------|
| Home \| Friends \| Groups \| Profile | Home \| Friends \| Groups \| **+** |
| Profile via tab | Profile via avatar on Home |
| Add expense via Quick Actions on Home | Add expense via **+** from anywhere |
| Settle Up via Quick Actions | Settle Up via summary card footer |

---

## Locked design decisions

| Topic | Decision |
|-------|----------|
| Create Group | **Groups tab** owns creation (empty state + header action). Universal add sheet does **not** include it. |
| 4th tab affordance | Floating **`+`** in Liquid Glass (iOS) / M3 elevated surface (Android) |
| Universal add sheet | Tab-layout-level sheet; search-as-navigation; selection → expense screen |
| Recents tiering | (1) Friends/groups with outstanding balance → (2) Last 5–8 add-expense targets → (3) Full list on search |
| Profile | Remove tab; access via **avatar** on Home; move to stack route `/profile` |
| Summary card visual | `FrostedSurface`; accent on **net number only**; sub-stats informational; **Settle up →** glass pill when outstanding |
| Settle interaction | Footer pill opens **SettlePickerSheet** with “You owe” / “You get back” sections; tap person → `/settle-up?friendId=…` |
| Zero balance state | Neutral card styling; no settle pill; card not tappable |
| Android parity | Same flows; `FrostedSurface` falls back to M3 surface (no blur) |

---

## Architecture overview

```
app/(tabs)/_layout.tsx
├── NativeTabs (3 real tabs: index, friends, groups)
├── AddSearchProvider          ← NEW context
├── Floating + trigger           ← NEW (4th slot or BottomAccessory overlay)
└── PeopleSearchSheet (global)   ← lifted from add-expense only

app/(tabs)/index.tsx
├── HomeHeader
│   ├── Avatar → router.push('/profile')
│   └── BalanceSummaryCard     ← NEW component (FrostedSurface)
│       └── Settle up pill → SettlePickerSheet
└── Recent Activity list

app/profile.tsx                  ← moved from app/(tabs)/profile.tsx
components/balance-summary-card.tsx   ← NEW
components/settle-picker-sheet.tsx    ← NEW
hooks/use-recent-expense-targets.ts   ← NEW (tier-2 recents)
contexts/add-search-context.tsx       ← NEW
```

### Existing code to reuse

| Asset | Location | Role |
|-------|----------|------|
| `PeopleSearchSheet` | `components/people-search-sheet.tsx` | Universal add picker (extend for recents tiering) |
| `FrostedSurface` | `components/ui/frosted-surface.tsx` | Summary card + FAB material |
| `useEnrichedContacts` | `hooks/use-enriched-contacts.ts` | Contact/group data for add sheet |
| `useFriends` | `hooks/use-friends.ts` | Balance summary + settle picker data |
| `settle-up` search logic | `app/settle-up.tsx` → extract | `searchFriendsWithBalance` for SettlePickerSheet |
| `SheetBackground` | `components/ui/sheet-background.tsx` | Sheet chrome |

---

## Phase 1 — Summary card redesign + Settle picker

**Goal:** Home feels lighter immediately. No tab bar changes yet.

### Step 1.1 — Extract `BalanceSummaryCard` component

**Create:** `components/balance-summary-card.tsx`

**Props (suggested):**
```ts
interface BalanceSummaryCardProps {
  netBalance: number;
  totalOwed: number;    // money you get back
  totalOwing: number;   // money you owe
  isLoading: boolean;
  onSettleUp: () => void;
}
```

**Visual spec:**
- Wrap in `FrostedSurface` (`variant="elevated"`)
- **Hero row:** label (`You are owed` / `You owe` / `All settled up`) + net amount
- Net amount color:
  - `netBalance > 0` → `colors.success`
  - `netBalance < 0` → `colors.error`
  - `netBalance === 0` → secondary/neutral text color
- **Sub-stats row:** “You get back” and “You owe” in secondary text (not pressable)
- **Footer:** glass pill “Settle up →” only when `totalOwed > 0 || totalOwing > 0`
  - Use nested `FrostedSurface` or subtle tint for the pill
  - `hapticLight()` on press
  - Offline: call `showOfflineAlert` (same as current Quick Action)

**Remove from card:** solid green/red `backgroundColor` block (current `index.tsx` lines ~123–130).

### Step 1.2 — Create `SettlePickerSheet`

**Create:** `components/settle-picker-sheet.tsx`

**Behavior:**
- Bottom sheet (same stack as `PeopleSearchSheet`: `@gorhom/bottom-sheet`, `SheetBackground`)
- Auto-focus search field on open
- Two sections when applicable:
  - **You owe** — friends where `total_balance < 0`, sorted by `|balance|` desc
  - **You get back** — friends where `total_balance > 0`, sorted similarly
- Search filters within both sections by name
- Row tap → close sheet → `router.push('/settle-up?friendId=…&friendName=…&balance=…&currency=…')`
- Empty state: “No outstanding balances”

**Data source:** `useFriends()` — already has `total_balance` per friend. Avoid duplicating `settle-up.tsx` RPC loop if possible.

**Extract (optional but recommended):** move `searchFriendsWithBalance` from `app/settle-up.tsx` into `hooks/use-settle-targets.ts` so both settle-up screen and sheet share one hook.

### Step 1.3 — Wire into Home

**Edit:** `app/(tabs)/index.tsx`

- Replace inline balance card JSX in `HomeHeader` with `<BalanceSummaryCard />`
- Add `settlePickerRef` + mount `SettlePickerSheet` at Home screen level (or a small wrapper)
- Remove Quick Actions section entirely (lines ~173–230)
- Remove dead handlers: `handleAddExpense`, `handleCreateGroup`, `handleSettleUp` (keep settle logic on card only)
- Remove unused styles: `actionsRow`, `actionCard`, `actionIcon`, `actionLabel`

### Step 1.4 — Analytics

**Edit:** `lib/analytics-events.ts`

Add:
```ts
SETTLE_UP_SHEET_OPENED: 'settle_up_sheet_opened',  // entry_point: 'home_summary_card'
SUMMARY_CARD_VIEWED: 'summary_card_viewed',         // optional
```

Track settle sheet open with `entry_point: 'home_summary_card'`.

### Phase 1 checklist

- [ ] Summary card uses frosted material on iOS and M3 surface on Android
- [ ] Net accent colors correct for positive / negative / zero
- [ ] Settle pill hidden when fully settled
- [ ] Settle pill blocked offline with alert
- [ ] SettlePickerSheet lists correct directional sections
- [ ] Selection navigates to settle-up with prefill
- [ ] Quick Actions removed from Home
- [ ] Home scroll / FlashList header still stable (no remount regressions)

---

## Phase 2 — Profile off tabs

**Goal:** Free the 4th tab slot; profile accessible from avatar only.

### Step 2.1 — Move profile route

1. Move `app/(tabs)/profile.tsx` → `app/profile.tsx`
2. Register in root stack if needed (`app/_layout.tsx` — file-based routing should pick it up automatically)
3. Update all navigations:
   - `router.push('/(tabs)/profile')` → `router.push('/profile')`
   - Grep for `/(tabs)/profile` and `profile` tab references

**Files likely affected:**
- `app/(tabs)/index.tsx` (avatar `onPress`)
- Any deep links or analytics referencing profile tab

### Step 2.2 — Remove Profile tab

**Edit:** `app/(tabs)/_layout.tsx`

- Remove `<NativeTabs.Trigger name="profile">` block
- Remove `profile: NAV_EVENTS.TAB_PROFILE_VIEWED` from `TAB_ANALYTICS`

### Step 2.3 — Analytics

- Replace `TAB_PROFILE_VIEWED` with `PROFILE_OPENED` (entry_point: `home_avatar` | `settings` | …)
- Track avatar tap on Home

### Phase 2 checklist

- [ ] Profile opens from Home avatar
- [ ] Profile back navigation returns to previous screen (not a dead tab)
- [ ] No broken links to `/(tabs)/profile`
- [ ] Tab bar shows 3 tabs only (temporarily, before Phase 3 adds +)

---

## Phase 3 — Universal add sheet + floating + tab

**Goal:** Add expense from anywhere in one tap. Search is navigation.

### Step 3.1 — Create `AddSearchContext`

**Create:** `contexts/add-search-context.tsx`

```ts
interface AddSearchContextValue {
  openAddSheet: () => void;
  closeAddSheet: () => void;
  isOpen: boolean;
}
```

Provider holds:
- `bottomSheetRef` for `PeopleSearchSheet`
- Offline guard before open
- Selection handlers → `router.push('/add-expense?…')`

Mount provider in `app/(tabs)/_layout.tsx` wrapping tab content.

### Step 3.2 — Recents tiering hook

**Create:** `hooks/use-recent-expense-targets.ts`

**Tier 1 — Outstanding (from `useFriends` + `useGroups`):**
- Friends with `|total_balance| > 0`
- Groups with non-zero group balance (if available from `useGroups`)

**Tier 2 — Recent targets:**
- Persist last 5–8 selections in AsyncStorage (`lib/storage.ts` key: `settle:recent_expense_targets`)
- Update on successful target selection in add sheet
- Shape: `{ type: 'friend' | 'group', id: string, name: string, timestamp }`

**Tier 3 — Full search:**
- Existing `useEnrichedContacts` filter when user types

**Edit:** `components/people-search-sheet.tsx`

- Add prop `mode: 'add-expense' | 'multi-select' | …` (or `showRecentsTier`)
- When query empty: render tiered sections (Recent / Outstanding / Groups / Contacts)
- When query non-empty: flat filtered list (current behavior)
- Auto-focus search input on sheet expand (`ref.focus()` after `onChange` to index 0)

### Step 3.3 — Floating + tab trigger

**Edit:** `app/(tabs)/_layout.tsx`

**Approach A (preferred):** `NativeTabs.BottomAccessory` + centered FAB

- Position `FrostedSurface` circle with `+` icon above tab bar
- `onPress` → `openAddSheet()` (does not switch tabs)
- iOS: `GlassView` via `FrostedSurface`
- Android: elevated circular FAB

**Approach B (fallback if native tabs block non-nav triggers):**

- 4th `NativeTabs.Trigger` pointing to a minimal `app/(tabs)/add.tsx` screen that immediately opens sheet on focus and bounces back — hacky; avoid if possible.

**Spike first:** confirm whether a trigger without a screen file works, or BottomAccessory + overlay is required.

### Step 3.4 — Wire selection → expense

On contact select:
```ts
// Direct group exists
router.push(`/add-expense?friendId=${userId}&friendName=${name}`);

// Or group select
router.push(`/add-expense?groupId=${groupId}`);
```

On select:
1. Record to recent targets (tier 2)
2. Close sheet
3. Push add-expense with params (skip search mode — `hasPreselection` true)

**Edit:** `app/add-expense.tsx`

- Ensure preselected params skip sheet mount (already handled via `hasPreselection`)
- Update analytics `entry_point` enum: add `'tab_plus'`

### Step 3.5 — Remove redundant add entry points (optional cleanup)

Keep contextual entry points (friend detail, group detail) — they pre-fill and are still valid.

Remove any dead Home add-expense navigation (already gone in Phase 1).

### Step 3.6 — Analytics

**Edit:** `lib/analytics-events.ts`

Add:
```ts
ADD_SHEET_OPENED: 'add_sheet_opened',       // entry_point: 'tab_plus'
ADD_SHEET_TARGET_SELECTED: 'add_sheet_target_selected',
TAB_ADD_TAPPED: 'tab_add_tapped',
```

Remove or deprecate: `TAB_PROFILE_VIEWED`

### Phase 3 checklist

- [ ] + visible on Home, Friends, and Groups tabs
- [ ] Sheet opens with keyboard focused
- [ ] Recents tier shows before typing
- [ ] Search filters instantly
- [ ] Group/contact selection lands on expense form (no intermediate search screen)
- [ ] Offline blocked with alert
- [ ] Android: no touch-blocking from sheet at index -1 (follow add-expense unmount pattern)
- [ ] Recent targets persist across app restarts

---

## Phase 4 — Visual polish & Liquid Glass pass

**Goal:** Cohesive lighter feel across Home and tab chrome.

### Step 4.1 — Summary card motion

- Entry spring animation (keep existing `MotiView` or match `FilterScrubber` damping)
- Settle pill: scale 0.97 on press

### Step 4.2 — Tab bar + FAB harmony

- Ensure FAB doesn’t collide with `FilterScrubber` on Friends/Groups
- Audit `useTabBarOffset()` — may need extra padding when FAB overlaps list content
- Confirm `minimizeBehavior="onScrollDown"` still works (FlashList limitation documented in `_layout.tsx`)

### Step 4.3 — Sheet presentation

- Use `SheetBackground` + frosted handle
- Sheet title: **“Add expense”** (not “Search the app”)
- Consider `enablePanDownToClose` + backdrop blur

### Step 4.4 — Home header simplification (optional)

- Shorten greeting or remove “Welcome back” for more whitespace
- Avatar remains top-right profile entry

### Phase 4 checklist

- [ ] Light and dark mode both look intentional
- [ ] FAB readable over tab bar on all tab screens
- [ ] No layout overlap with filter scrubber
- [ ] Sheet feels like overlay, not a new page stack

---

## File change summary

| Action | File |
|--------|------|
| **Create** | `components/balance-summary-card.tsx` |
| **Create** | `components/settle-picker-sheet.tsx` |
| **Create** | `contexts/add-search-context.tsx` |
| **Create** | `hooks/use-recent-expense-targets.ts` |
| **Create** | `hooks/use-settle-targets.ts` (optional extract) |
| **Move** | `app/(tabs)/profile.tsx` → `app/profile.tsx` |
| **Edit** | `app/(tabs)/index.tsx` |
| **Edit** | `app/(tabs)/_layout.tsx` |
| **Edit** | `components/people-search-sheet.tsx` |
| **Edit** | `app/add-expense.tsx` (analytics entry points) |
| **Edit** | `lib/analytics-events.ts` |
| **Edit** | `lib/storage.ts` (recent targets key) |

---

## Testing plan

### Manual flows

1. **New user:** Home shows neutral card, no settle pill, + opens add sheet, empty recents
2. **User with balances:** Card shows net + sub-stats + settle pill; sheet sections correct
3. **Settle flow:** Home → Settle up → pick friend → amount pre-filled → submit
4. **Add flow:** Friends tab → + → pick group → expense form
5. **Profile:** Home avatar → profile → edit → back to Home
6. **Create group:** Groups tab empty state / header → create group (not in add sheet)
7. **Offline:** + and Settle up both show offline alert
8. **Android:** sheets close cleanly, no ghost touch blockers

### Regression targets

- Friend detail “Add expense” / “Settle up” still work with preselection
- Group detail “Add expense” still passes `groupId`
- `create-group` PeopleSearchSheet (multi-select) unchanged
- Group settings member picker unchanged

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Native tabs don’t support non-nav + button | Spike early; use BottomAccessory overlay |
| FlashList header remount animations replay | Keep `HomeHeader` as module-level component (existing pattern) |
| Android bottom sheet touch blocking | Unmount sheet when closed; never leave index=-1 sheet mounted |
| Recents tier shows too many contacts | Cap tier 1+2 at ~8 items; full list only when searching |
| `useFriends` balance stale on settle | Existing `useFocusEffect` refresh on Home; invalidate on settlement |

---

## Suggested implementation order

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4
  │            │            │
  │            │            └── Depends on Phase 2 (free tab slot)
  │            └── Can ship independently after Phase 1
  └── Start here (biggest visible win, lowest risk)
```

Each phase is shippable on its own. Recommended: **one PR per phase** for easier review.

---

## Out of scope (v2)

- Tappable “You owe” / “You get back” sub-rows (pre-filtered sheet sections)
- Skip settle sheet when exactly one outstanding friend
- Create Group row in add sheet footer
- Universal in-app search (expenses, settings, etc.)
- Summary card tap anywhere (whole-card press target)

---

## Reference: current vs target Home layout

**Current**
```
[Greeting + Avatar]
[Solid green/red balance card]
[Quick Actions: Add | Create Group | Settle Up]
[Recent Activity]
```

**Target**
```
[Greeting + Avatar → Profile]
[Frosted balance card + Settle up pill]
[Recent Activity]

Tab bar: Home | Friends | Groups | [+]
```
