/**
 * useEnrichedContacts
 *
 * Core data hook for contact + group loading. Responsible for:
 *   1. Reading device contacts (with permission handling)
 *   2. Batch-querying Supabase to match phone numbers → { userId, avatarUrl }
 *   3. Fetching the current user's groups (regular + direct)
 *   4. Returning fully-enriched contacts ready for any consumer
 *
 * Downstream hooks (useContactGroupSearch) and future UI components
 * (PeopleSearchSheet) both consume this single source of truth.
 */

import * as Contacts from 'expo-contacts';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import type { ContactEntry } from '@/types';

import type { SearchResultGroup } from './use-contact-group-search';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnrichedContact extends ContactEntry {
  /** Supabase user id if this phone number is registered (or shadow) in the app */
  userId?: string;
  /** Profile photo URL, populated only when userId is present */
  avatarUrl?: string | null;
  /** True when a 1-to-1 direct group already exists between this user and the viewer */
  hasDirectGroup: boolean;
}

export interface UseEnrichedContactsResult {
  /** All device contacts, enriched with in-app user data */
  contacts: EnrichedContact[];
  /** Regular (named) groups the current user belongs to */
  groups: SearchResultGroup[];
  isLoading: boolean;
  hasContactPermission: boolean | null;
  loadInitialData: () => Promise<void>;
}

// ─── Shared utility ───────────────────────────────────────────────────────────

/**
 * Normalise a raw phone number to E.164 (+91 Indian default).
 * Handles: spaces, dashes, leading 0, bare 10-digit numbers, existing + prefix.
 *
 * Exported so callers (add-expense, settings) can stop duplicating this logic.
 */
export function normalizePhone(phone: string): string {
  const clean = phone.replace(/[\s-]/g, '');
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('91') && clean.length > 10) return `+${clean}`;
  return `+91${clean.replace(/^0/, '')}`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Load device contacts and batch-enrich with Supabase user data in one pass. */
async function fetchAndEnrichContacts(): Promise<{
  flatContacts: ContactEntry[];
  userPhoneMap: Map<string, { id: string; avatarUrl: string | null }>;
  hasPermission: boolean;
}> {
  // Browsers have no device address book; keep permission "granted" with an empty
  // list so friends/groups search still renders.
  if (Platform.OS === 'web') {
    return { flatContacts: [], userPhoneMap: new Map(), hasPermission: true };
  }

  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    return { flatContacts: [], userPhoneMap: new Map(), hasPermission: false };
  }

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });

  // Flatten: one entry per phone number (same id scheme as ContactPickerSheet)
  const flatContacts: ContactEntry[] = [];
  data.forEach((contact) => {
    if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
      contact.phoneNumbers.forEach((phoneNumber, index) => {
        if (phoneNumber.number) {
          flatContacts.push({
            id: `${contact.id}_${index}`,
            name: contact.name || 'Unknown',
            phone: phoneNumber.number.replace(/\s/g, ''),
            phoneLabel: phoneNumber.label || undefined,
          });
        }
      });
    }
  });

  flatContacts.sort((a, b) => a.name.localeCompare(b.name));

  // Single Supabase query for all matched users
  const userPhoneMap = new Map<string, { id: string; avatarUrl: string | null }>();
  const normalizedPhones = flatContacts.map(c => normalizePhone(c.phone));

  if (normalizedPhones.length > 0) {
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id, phone, avatar_url')
      .in('phone', normalizedPhones);

    existingUsers?.forEach(u => {
      userPhoneMap.set(u.phone, { id: u.id, avatarUrl: u.avatar_url });
    });
  }

  return { flatContacts, userPhoneMap, hasPermission: true };
}

/** Fetch the current user's groups and the set of user ids with existing direct groups. */
async function fetchGroupsAndDirectIds(userId: string): Promise<{
  groupResults: SearchResultGroup[];
  directGroupUserIds: Set<string>;
}> {
  const { data: memberData } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId);

  if (!memberData || memberData.length === 0) {
    return { groupResults: [], directGroupUserIds: new Set() };
  }

  const groupIds = memberData.map(m => m.group_id);

  const [groupsResult, membersResult] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, type, image_url')
      .in('id', groupIds)
      .is('deleted_at', null),
    supabase
      .from('group_members')
      .select('group_id')
      .in('group_id', groupIds),
  ]);

  const allGroupsData = groupsResult.data ?? [];
  const regularGroups = allGroupsData.filter(g => g.type === 'group');
  const directGroups = allGroupsData.filter(g => g.type === 'direct');

  // Member counts for the subtitle ("4 members")
  const memberCounts: Record<string, number> = {};
  membersResult.data?.forEach(m => {
    memberCounts[m.group_id] = (memberCounts[m.group_id] || 0) + 1;
  });

  const groupResults: SearchResultGroup[] = regularGroups.map(g => ({
    type: 'group',
    id: g.id,
    name: g.name,
    image_url: g.image_url ?? null,
    memberCount: memberCounts[g.id] || 1,
  }));

  // Which users already have a 1-to-1 direct group with the viewer
  let directGroupUserIds = new Set<string>();
  if (directGroups.length > 0) {
    const directGroupIds = directGroups.map(g => g.id);
    const { data: directMembers } = await supabase
      .from('group_members')
      .select('user_id')
      .in('group_id', directGroupIds)
      .neq('user_id', userId);

    directGroupUserIds = new Set(directMembers?.map(m => m.user_id) ?? []);
  }

  return { groupResults, directGroupUserIds };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEnrichedContacts(): UseEnrichedContactsResult {
  const { user } = useAuth();

  const [contacts, setContacts] = useState<EnrichedContact[]>([]);
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasContactPermission, setHasContactPermission] = useState<boolean | null>(null);

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Run contact enrichment and group fetching in parallel
      const [contactResult, groupResult] = await Promise.all([
        fetchAndEnrichContacts(),
        user ? fetchGroupsAndDirectIds(user.id) : Promise.resolve({
          groupResults: [] as SearchResultGroup[],
          directGroupUserIds: new Set<string>(),
        }),
      ]);

      setHasContactPermission(contactResult.hasPermission);

      if (contactResult.hasPermission) {
        const { flatContacts, userPhoneMap } = contactResult;
        const { directGroupUserIds } = groupResult;

        // Combine flat contacts + enrichment data in one pass
        const enriched: EnrichedContact[] = flatContacts.map(contact => {
          const normalized = normalizePhone(contact.phone);
          const appUser = userPhoneMap.get(normalized);
          return {
            ...contact,
            userId: appUser?.id,
            avatarUrl: appUser?.avatarUrl,
            hasDirectGroup: appUser?.id ? directGroupUserIds.has(appUser.id) : false,
          };
        });

        setContacts(enriched);
      }

      setGroups(groupResult.groupResults);
    } catch (error) {
      console.error('[useEnrichedContacts] Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  return { contacts, groups, isLoading, hasContactPermission, loadInitialData };
}
