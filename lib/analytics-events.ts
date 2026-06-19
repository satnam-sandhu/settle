/**
 * PostHog Event Names
 * 
 * Naming convention: snake_case
 * Format: [object]_[action] (e.g., expense_created)
 */

// Authentication Events
export const AUTH_EVENTS = {
  SIGN_UP_STARTED: 'sign_up_started',
  SIGN_UP_OTP_REQUESTED: 'sign_up_otp_requested',
  SIGN_UP_OTP_VERIFIED: 'sign_up_otp_verified',
  SIGN_UP_PASSWORD_SET: 'sign_up_password_set',
  SIGN_UP_COMPLETED: 'sign_up_completed',
  SIGN_UP_FAILED: 'sign_up_failed',
  
  SIGN_IN_STARTED: 'sign_in_started',
  SIGN_IN_COMPLETED: 'sign_in_completed',
  SIGN_IN_FAILED: 'sign_in_failed',
  
  SIGN_OUT: 'sign_out',
  
  FORGOT_PASSWORD_STARTED: 'forgot_password_started',
  FORGOT_PASSWORD_OTP_REQUESTED: 'forgot_password_otp_requested',
  FORGOT_PASSWORD_COMPLETED: 'forgot_password_completed',
} as const;

// Expense Events
export const EXPENSE_EVENTS = {
  ADD_EXPENSE_STARTED: 'add_expense_started',
  ADD_EXPENSE_GROUP_SELECTED: 'add_expense_group_selected',
  ADD_EXPENSE_CONTACT_SELECTED: 'add_expense_contact_selected',
  ADD_EXPENSE_AMOUNT_ENTERED: 'add_expense_amount_entered',
  ADD_EXPENSE_CATEGORY_SELECTED: 'add_expense_category_selected',
  ADD_EXPENSE_COMPLETED: 'add_expense_completed',
  ADD_EXPENSE_FAILED: 'add_expense_failed',
  ADD_EXPENSE_CANCELLED: 'add_expense_cancelled',

  EXPENSE_VIEWED: 'expense_viewed',
  EXPENSE_EDITED: 'expense_edited',
  EXPENSE_DELETED: 'expense_deleted',
} as const;

/** Known entry_point values for add-expense analytics */
export type AddExpenseEntryPoint =
  | 'tab_plus'
  | 'group'
  | 'friend'
  | 'friends_tab'
  | 'home';

// Settlement Events
export const SETTLEMENT_EVENTS = {
  SETTLE_UP_STARTED: 'settle_up_started',
  SETTLE_UP_SHEET_OPENED: 'settle_up_sheet_opened',
  SETTLE_UP_FRIEND_SELECTED: 'settle_up_friend_selected',
  SETTLE_UP_AMOUNT_ENTERED: 'settle_up_amount_entered',
  SETTLE_UP_COMPLETED: 'settle_up_completed',
  SETTLE_UP_FAILED: 'settle_up_failed',
  SETTLE_UP_CANCELLED: 'settle_up_cancelled',
} as const;

// Home Events
export const HOME_EVENTS = {
  SUMMARY_CARD_VIEWED: 'summary_card_viewed',
} as const;

// Add sheet events (global tab + picker)
export const ADD_SHEET_EVENTS = {
  ADD_SHEET_OPENED: 'add_sheet_opened',
  ADD_SHEET_TARGET_SELECTED: 'add_sheet_target_selected',
} as const;

export type AddSheetEntryPoint = 'tab_plus' | 'friends_empty';

// Group Events
export const GROUP_EVENTS = {
  CREATE_GROUP_STARTED: 'create_group_started',
  CREATE_GROUP_NAME_ENTERED: 'create_group_name_entered',
  CREATE_GROUP_MEMBERS_ADDED: 'create_group_members_added',
  CREATE_GROUP_COMPLETED: 'create_group_completed',
  CREATE_GROUP_FAILED: 'create_group_failed',
  CREATE_GROUP_CANCELLED: 'create_group_cancelled',
  
  GROUP_VIEWED: 'group_viewed',
  GROUP_SETTINGS_VIEWED: 'group_settings_viewed',
  GROUP_MEMBER_ADDED: 'group_member_added',
  GROUP_MEMBER_REMOVED: 'group_member_removed',
  GROUP_LEFT: 'group_left',
} as const;

// Friend Events
export const FRIEND_EVENTS = {
  FRIEND_ADDED: 'friend_added',
  FRIEND_VIEWED: 'friend_viewed',
} as const;

// Navigation Events
export const NAV_EVENTS = {
  TAB_HOME_VIEWED: 'tab_home_viewed',
  TAB_GROUPS_VIEWED: 'tab_groups_viewed',
  TAB_FRIENDS_VIEWED: 'tab_friends_viewed',
  TAB_ADD_TAPPED: 'tab_add_tapped',
  PROFILE_OPENED: 'profile_opened',

  SCREEN_VIEWED: 'screen_viewed',
} as const;

// Feature Usage Events
export const FEATURE_EVENTS = {
  SEARCH_PERFORMED: 'search_performed',
  CATEGORY_BROWSED: 'category_browsed',
  CURRENCY_CHANGED: 'currency_changed',
  PULL_TO_REFRESH: 'pull_to_refresh',
  CONTACT_PERMISSION_REQUESTED: 'contact_permission_requested',
  CONTACT_PERMISSION_GRANTED: 'contact_permission_granted',
  CONTACT_PERMISSION_DENIED: 'contact_permission_denied',
} as const;

// App Lifecycle Events
export const APP_EVENTS = {
  APP_OPENED: 'app_opened',
  APP_BACKGROUNDED: 'app_backgrounded',
  APP_FOREGROUNDED: 'app_foregrounded',
  OFFLINE_MODE_ENTERED: 'offline_mode_entered',
  ONLINE_MODE_RESTORED: 'online_mode_restored',
} as const;
