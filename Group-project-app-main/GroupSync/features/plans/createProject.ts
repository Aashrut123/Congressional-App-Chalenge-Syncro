import { supabase } from '@/lib/supabase';

/** Insert without RETURNING. The owner row is created by a trigger, so a select in the same statement can fail RLS. */
export async function insertProject(row: Record<string, string | null>) {
  const inserted = await supabase.from('groups').insert(row);
  if (inserted.error) return { id: null as string | null, error: inserted.error };
  const found = await supabase
    .from('groups')
    .select('id')
    .eq('created_by', row.created_by)
    .eq('name', row.name)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (found.error) return { id: null, error: found.error };
  return { id: found.data?.id ?? null, error: null };
}
