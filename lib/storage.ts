/**
 * Offline Storage Layer
 * 
 * Handles local caching of data using AsyncStorage.
 * Provides typed get/set operations with JSON serialization.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage key prefixes
const STORAGE_KEYS = {
  // Cached data
  USER: 'settle:user',
  GROUPS: 'settle:groups',
  GROUPS_LIST: 'settle:groups_list', // Transformed GroupListItem[]
  GROUP_MEMBERS: 'settle:group_members',
  EXPENSES: 'settle:expenses',
  EXPENSE_SPLITS: 'settle:expense_splits',
  SETTLEMENTS: 'settle:settlements',
  CATEGORIES: 'settle:categories',
  FRIENDS: 'settle:friends',
  RECENT_ACTIVITY: 'settle:recent_activity',
  RECENT_EXPENSE_TARGETS: 'settle:recent_expense_targets',
  
  // Dynamic cache keys (prefixes - append ID)
  GROUP_DETAIL_PREFIX: 'settle:group_detail:',
  FRIEND_DETAIL_PREFIX: 'settle:friend_detail:',
  EXPENSES_PREFIX: 'settle:expenses:',
  
  // Sync state
  SYNC_QUEUE: 'settle:sync_queue',
  LAST_SYNC: 'settle:last_sync',
  
  // Pending items (created offline, not yet synced)
  PENDING_EXPENSES: 'settle:pending_expenses',
  PENDING_SETTLEMENTS: 'settle:pending_settlements',
  
  // App state
  ONBOARDED: 'settle:onboarded',
  
  // User preferences
  THEME: 'settle:theme',
  DEFAULT_CURRENCY: 'settle:default_currency',
  NOTIFICATIONS_ENABLED: 'settle:notifications_enabled',
} as const;

export { STORAGE_KEYS };

/**
 * Generic storage operations
 */
export const storage = {
  /**
   * Get a value from storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      console.error(`[Storage] Error getting ${key}:`, error);
      return null;
    }
  },

  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`[Storage] Error setting ${key}:`, error);
      return false;
    }
  },

  /**
   * Remove a value from storage
   */
  async remove(key: string): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error(`[Storage] Error removing ${key}:`, error);
      return false;
    }
  },

  /**
   * Clear all settle-related data (for logout)
   */
  async clearAll(): Promise<boolean> {
    try {
      const keys = Object.values(STORAGE_KEYS);
      await AsyncStorage.multiRemove(keys);
      return true;
    } catch (error) {
      console.error('[Storage] Error clearing all:', error);
      return false;
    }
  },

  /**
   * Get multiple values at once
   */
  async getMultiple<T extends Record<string, unknown>>(
    keys: string[]
  ): Promise<Partial<T>> {
    try {
      const pairs = await AsyncStorage.multiGet(keys);
      const result: Record<string, unknown> = {};
      for (const [key, value] of pairs) {
        if (value !== null) {
          result[key] = JSON.parse(value);
        }
      }
      return result as Partial<T>;
    } catch (error) {
      console.error('[Storage] Error getting multiple:', error);
      return {};
    }
  },

  /**
   * Set multiple values at once
   */
  async setMultiple(items: Record<string, unknown>): Promise<boolean> {
    try {
      const pairs: [string, string][] = Object.entries(items).map(
        ([key, value]) => [key, JSON.stringify(value)]
      );
      await AsyncStorage.multiSet(pairs);
      return true;
    } catch (error) {
      console.error('[Storage] Error setting multiple:', error);
      return false;
    }
  },
};

/**
 * Cache helpers for specific entity types
 */
export const cache = {
  // ============================================
  // USER
  // ============================================
  async getUser() {
    return storage.get(STORAGE_KEYS.USER);
  },
  async setUser(user: unknown) {
    return storage.set(STORAGE_KEYS.USER, user);
  },

  // ============================================
  // GROUPS (raw data)
  // ============================================
  async getGroups() {
    return storage.get<unknown[]>(STORAGE_KEYS.GROUPS) ?? [];
  },
  async setGroups(groups: unknown[]) {
    return storage.set(STORAGE_KEYS.GROUPS, groups);
  },

  // ============================================
  // GROUPS LIST (transformed GroupListItem[])
  // ============================================
  async getGroupsList<T>(): Promise<T[]> {
    return (await storage.get<T[]>(STORAGE_KEYS.GROUPS_LIST)) ?? [];
  },
  async setGroupsList<T>(groups: T[]) {
    return storage.set(STORAGE_KEYS.GROUPS_LIST, groups);
  },

  // ============================================
  // FRIENDS
  // ============================================
  async getFriends<T>(): Promise<T[]> {
    return (await storage.get<T[]>(STORAGE_KEYS.FRIENDS)) ?? [];
  },
  async setFriends<T>(friends: T[]) {
    return storage.set(STORAGE_KEYS.FRIENDS, friends);
  },

  // ============================================
  // RECENT ACTIVITY
  // ============================================
  async getRecentActivity<T>(): Promise<T[]> {
    return (await storage.get<T[]>(STORAGE_KEYS.RECENT_ACTIVITY)) ?? [];
  },
  async setRecentActivity<T>(activity: T[]) {
    return storage.set(STORAGE_KEYS.RECENT_ACTIVITY, activity);
  },

  // ============================================
  // RECENT EXPENSE TARGETS (add sheet tier 2)
  // ============================================
  async getRecentExpenseTargets<T>(): Promise<T[]> {
    return (await storage.get<T[]>(STORAGE_KEYS.RECENT_EXPENSE_TARGETS)) ?? [];
  },
  async setRecentExpenseTargets<T>(targets: T[]) {
    return storage.set(STORAGE_KEYS.RECENT_EXPENSE_TARGETS, targets);
  },

  // ============================================
  // GROUP DETAIL (dynamic key by groupId)
  // ============================================
  async getGroupDetail<T>(groupId: string): Promise<T | null> {
    return storage.get<T>(`${STORAGE_KEYS.GROUP_DETAIL_PREFIX}${groupId}`);
  },
  async setGroupDetail<T>(groupId: string, data: T) {
    return storage.set(`${STORAGE_KEYS.GROUP_DETAIL_PREFIX}${groupId}`, data);
  },

  // ============================================
  // FRIEND DETAIL (dynamic key by friendId)
  // ============================================
  async getFriendDetail<T>(friendId: string): Promise<T | null> {
    return storage.get<T>(`${STORAGE_KEYS.FRIEND_DETAIL_PREFIX}${friendId}`);
  },
  async setFriendDetail<T>(friendId: string, data: T) {
    return storage.set(`${STORAGE_KEYS.FRIEND_DETAIL_PREFIX}${friendId}`, data);
  },

  // ============================================
  // EXPENSES (dynamic key by groupId)
  // ============================================
  async getExpenses<T>(groupId: string): Promise<T[]> {
    return (await storage.get<T[]>(`${STORAGE_KEYS.EXPENSES_PREFIX}${groupId}`)) ?? [];
  },
  async setExpenses<T>(groupId: string, expenses: T[]) {
    return storage.set(`${STORAGE_KEYS.EXPENSES_PREFIX}${groupId}`, expenses);
  },

  // ============================================
  // CATEGORIES
  // ============================================
  async getCategories() {
    return storage.get<unknown[]>(STORAGE_KEYS.CATEGORIES) ?? [];
  },
  async setCategories(categories: unknown[]) {
    return storage.set(STORAGE_KEYS.CATEGORIES, categories);
  },

  // ============================================
  // LAST SYNC TIME
  // ============================================
  async getLastSync(): Promise<string | null> {
    return storage.get<string>(STORAGE_KEYS.LAST_SYNC);
  },
  async setLastSync(timestamp: string) {
    return storage.set(STORAGE_KEYS.LAST_SYNC, timestamp);
  },
};
