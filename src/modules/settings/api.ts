import { supabase } from '@/lib/supabase'
import type { Profile, Supplier, SupplierInsert, UserRole } from '@/lib/database.types'

export async function listSuppliers(includeArchived = false) {
  let q = supabase.from('suppliers').select('*').order('name')
  if (!includeArchived) q = q.is('archived_at', null)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Supplier[]
}

export async function saveSupplier(row: SupplierInsert, id?: string) {
  const q = id
    ? supabase.from('suppliers').update(row).eq('id', id).select('*').single()
    : supabase.from('suppliers').insert(row).select('*').single()
  const { data, error } = await q
  if (error) throw error
  return data as Supplier
}

export async function listProfiles() {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at')
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function updateProfile(id: string, patch: Partial<Pick<Profile, 'role' | 'active' | 'full_name'>>) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  if (error) throw error
}

export const ROLE_LABEL: Record<UserRole, string> = { admin: 'Administrador', operador: 'Operador' }
