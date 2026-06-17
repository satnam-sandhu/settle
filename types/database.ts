/**
 * Database types matching Supabase schema
 * These types represent the raw database rows
 */

// ============================================
// ENUMS & CONSTANTS
// ============================================

export type GroupMemberRole = 'admin' | 'member';

export type GroupType = 'group' | 'direct'; // 'group' = explicit named group, 'direct' = auto-created 1:1 group

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD';

export const CURRENCIES: Record<CurrencyCode, { symbol: string; name: string }> = {
  INR: { symbol: '₹', name: 'Indian Rupee' },
  USD: { symbol: '$', name: 'US Dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  GBP: { symbol: '£', name: 'British Pound' },
  JPY: { symbol: '¥', name: 'Japanese Yen' },
  AUD: { symbol: 'A$', name: 'Australian Dollar' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar' },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'INR';

// ============================================
// DATABASE ROW TYPES
// ============================================

/**
 * OTP purpose type
 */
export type OtpPurpose = 'signup' | 'forgot_password';

/**
 * OTP request record
 */
export interface DbOtpRequest {
  id: string;
  phone: string;
  otp_hash: string;
  purpose: OtpPurpose;
  expires_at: string;
  verified: boolean;
  attempts: number;
  created_at: string;
}

/**
 * User profile (extends Supabase auth.users)
 */
export interface DbUser {
  id: string;
  phone: string;
  name: string;
  avatar_url: string | null;
  default_currency: CurrencyCode;
  is_registered?: boolean; // Optional because legacy users effectively have it true
  notifications_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Expo push token registered for a single device install.
 */
export interface DbUserPushToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android';
  app_version: string | null;
  device_name: string | null;
  last_seen_at: string;
  created_at: string;
}

export type NotificationDispatchStatus = 'skipped' | 'sent' | 'partial' | 'error';

export interface DbNotificationDispatch {
  id: string;
  event: string;
  entity_id: string | null;
  actor_user_id: string | null;
  title: string;
  body: string;
  collapse_id: string | null;
  payload_data: Record<string, unknown> | null;
  status: NotificationDispatchStatus;
  skip_reason: string | null;
  recipient_ids: string[] | null;
  sent_count: number;
  ticket_count: number;
  error_message: string | null;
  created_at: string;
}

export interface DbNotificationDispatchRecipient {
  id: string;
  dispatch_id: string;
  user_id: string | null;
  token: string | null;
  status: 'skipped' | 'sent' | 'error';
  skip_reason: string | null;
  expo_ticket_id: string | null;
  error_message: string | null;
  created_at: string;
}

/**
 * Group for shared expenses
 */
export interface DbGroup {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  currency: CurrencyCode;
  type: GroupType; // 'group' = explicit named group, 'direct' = auto-created 1:1 group
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Group membership junction
 */
export interface DbGroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupMemberRole;
  joined_at: string;
}

/**
 * Expense category
 */
export interface DbCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
}

/**
 * Expense record
 */
export interface DbExpense {
  id: string;
  group_id: string;
  /** When set, this expense is a line item under an expense_group (grouped expense). */
  expense_group_id: string | null;
  paid_by: string;
  amount: number;
  currency: CurrencyCode;
  description: string;
  category_id: string | null;
  notes: string | null;
  expense_date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Expense group (parent of 2+ child expenses — one "payment" with multiple split setups).
 */
export interface DbExpenseGroup {
  id: string;
  group_id: string;
  description: string;
  category_id: string | null;
  paid_by: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * How an expense is split among users
 */
export interface DbExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;
  amount: number;
  created_at: string;
}

/**
 * Settlement/payment between users
 */
export interface DbSettlement {
  id: string;
  group_id: string | null;
  paid_by: string;
  paid_to: string;
  amount: number;
  currency: CurrencyCode;
  notes: string | null;
  created_at: string;
}

// ============================================
// VIEW TYPES
// ============================================

/**
 * Group balance view row
 */
export interface DbGroupBalance {
  group_id: string;
  user_id: string;
  user_name: string;
  total_paid: number;
  total_owed: number;
  total_settled_paid: number;
  total_settled_received: number;
}

// ============================================
// INSERT TYPES (for creating new records)
// ============================================

export type DbUserInsert = Omit<DbUser, 'created_at' | 'updated_at'> & {
  notifications_enabled?: boolean;
};

export type DbUserPushTokenInsert = Omit<DbUserPushToken, 'id' | 'created_at' | 'last_seen_at'> & {
  last_seen_at?: string;
};

export type DbUserPushTokenUpdate = Partial<
  Pick<DbUserPushToken, 'app_version' | 'device_name' | 'last_seen_at'>
>;

export type DbGroupInsert = Omit<DbGroup, 'id' | 'created_at' | 'updated_at'>;

export type DbGroupMemberInsert = Omit<DbGroupMember, 'id' | 'joined_at'>;

export type DbExpenseInsert = Omit<DbExpense, 'id' | 'created_at' | 'updated_at'>;

export type DbExpenseSplitInsert = Omit<DbExpenseSplit, 'id' | 'created_at'>;

export type DbExpenseGroupInsert = Omit<DbExpenseGroup, 'id' | 'created_at' | 'updated_at'>;

export type DbSettlementInsert = Omit<DbSettlement, 'id' | 'created_at'>;

// ============================================
// UPDATE TYPES (for updating records)
// ============================================

export type DbUserUpdate = Partial<Omit<DbUser, 'id' | 'created_at' | 'updated_at'>>;

export type DbGroupUpdate = Partial<Omit<DbGroup, 'id' | 'created_by' | 'created_at' | 'updated_at'>>;

export type DbExpenseUpdate = Partial<Omit<DbExpense, 'id' | 'group_id' | 'created_by' | 'created_at' | 'updated_at'>>;
