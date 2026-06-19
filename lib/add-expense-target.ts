import type { EnrichedContact } from '@/hooks/use-enriched-contacts';
import { normalizePhone } from '@/hooks/use-enriched-contacts';
import { supabase } from '@/lib/supabase';

export async function resolveContactUserId(contact: EnrichedContact): Promise<string | undefined> {
  if (contact.userId) return contact.userId;

  const normalizedPhone = normalizePhone(contact.phone);
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', normalizedPhone)
    .single() as { data: { id: string } | null };

  if (existingUser) return existingUser.id;

  const { data: shadowUser, error: shadowError } = await supabase
    .from('users')
    .insert({ phone: normalizedPhone, name: contact.name, is_registered: false } as never)
    .select('id')
    .single() as { data: { id: string } | null; error: { code?: string } | null };

  if (shadowError) {
    const { data: retryUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .single() as { data: { id: string } | null };
    return retryUser?.id;
  }

  return shadowUser?.id;
}
